import { BaseEngine } from '../engines/baseEngine.js';
import { repositories } from '../repositories/index.js';

export class SmartMoneyFlowEngine extends BaseEngine {
  readonly name = 'SmartMoneyFlowEngine';
  readonly version = '1.0.0';

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const poolAddress = params?.poolAddress as string;
    const tokenMint = params?.tokenMint as string;

    if (!poolAddress) {
      return { score: 50, signal: 'neutral', reason: 'No pool address', metadata: {} };
    }

    const recentTxs = await repositories.transaction.getRecent(poolAddress, 60);

    const smartMoneyTxs = recentTxs.filter(t => t.isSmartMoney);
    const smartMoneyBuys = smartMoneyTxs.filter(t => t.type === 'buy');
    const smartMoneySells = smartMoneyTxs.filter(t => t.type === 'sell');

    const smBuyCount = smartMoneyBuys.length;
    const smSellCount = smartMoneySells.length;
    const smBuyVolume = smartMoneyBuys.reduce((s, t) => s + t.volumeUsd, 0);
    const smSellVolume = smartMoneySells.reduce((s, t) => s + t.volumeUsd, 0);

    const smTotalTx = smBuyCount + smSellCount;
    const smTxRatio = smTotalTx > 0 ? smBuyCount / smTotalTx : 0.5;
    const smVolRatio = (smBuyVolume + smSellVolume) > 0 ? smBuyVolume / (smBuyVolume + smSellVolume) : 0.5;

    const netSmartMoneyFlow = smBuyVolume - smSellVolume;
    const uniqueSmartMoneyBuyers = [...new Set(smartMoneyBuys.map(t => t.walletAddress))].length;
    const uniqueSmartMoneySellers = [...new Set(smartMoneySells.map(t => t.walletAddress))].length;

    const allTxCount = recentTxs.length;
    const smartMoneyShare = allTxCount > 0 ? smTotalTx / allTxCount : 0;

    // Phase 93: Cross-reference with HawkFi smart LP data
    let hawkfiEntries = 0;
    let hawkfiExits = 0;
    let hawkfiWalletCount = 0;
    try {
      const { integrations } = await import('../integrations/index.js');
      const hawkfi = integrations.hawkfi;
      const intel = await hawkfi.getPoolIntelligence(poolAddress);
      if (intel) {
        hawkfiEntries = intel.recentEntries;
        hawkfiExits = intel.recentExits;
        hawkfiWalletCount = intel.walletCount;
      }
    } catch { /* hawkfi unavailable */ }

    let score = 50;
    const signals: string[] = [];

    // HawkFi signal: recent entries by smart LPs = bullish, exits = bearish
    if (hawkfiEntries > hawkfiExits && hawkfiEntries >= 2) {
      score += 15;
      signals.push(`hawkfi: ${hawkfiEntries} smart LPs entered`);
    } else if (hawkfiExits > hawkfiEntries && hawkfiExits >= 2) {
      score -= 15;
      signals.push(`hawkfi: ${hawkfiExits} smart LPs exited (DANGER)`);
    }
    if (hawkfiWalletCount >= 2) {
      score += 10;
      signals.push(`hawkfi: ${hawkfiWalletCount} smart LPs in pool`);
    }

    if (smTxRatio > 0.7 && smVolRatio > 0.65 && uniqueSmartMoneyBuyers > 3) {
      score = Math.max(score, 90);
      signals.push('strong smart money inflow across multiple wallets');
    } else if (smTxRatio > 0.6 && smVolRatio > 0.55) {
      score = Math.max(score, 75);
      signals.push('moderate smart money inflow');
    } else if (smTxRatio > 0.55 && netSmartMoneyFlow > 0) {
      score = Math.max(score, 65);
      signals.push('slight smart money inflow');
    } else if (smTxRatio < 0.35 && smVolRatio < 0.4) {
      score = Math.min(score, 25);
      signals.push('smart money distributing');
    } else if (smTxRatio < 0.45 && netSmartMoneyFlow < 0) {
      score = Math.min(score, 35);
      signals.push('slight smart money outflow');
    }

    if (smartMoneyShare > 0.3) {
      score = Math.min(95, score + 5);
      signals.push('high smart money participation');
    }

    return {
      score: this.normalizeScore(score),
      signal: score >= 70 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'neutral smart money flow',
      metadata: {
        smBuyCount,
        smSellCount,
        smBuyVolume: Number(smBuyVolume.toFixed(2)),
        smSellVolume: Number(smSellVolume.toFixed(2)),
        smTxRatio: Number(smTxRatio.toFixed(2)),
        smVolRatio: Number(smVolRatio.toFixed(2)),
        netFlow: Number(netSmartMoneyFlow.toFixed(2)),
        uniqueBuyers: uniqueSmartMoneyBuyers,
        uniqueSellers: uniqueSmartMoneySellers,
        smartMoneyShare: Number(smartMoneyShare.toFixed(2)),
        hawkfiEntries,
        hawkfiExits,
        hawkfiWalletCount,
      },
    };
  }
}
