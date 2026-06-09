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

    let score = 50;
    const signals: string[] = [];

    if (smTxRatio > 0.7 && smVolRatio > 0.65 && uniqueSmartMoneyBuyers > 3) {
      score = 90;
      signals.push('strong smart money inflow across multiple wallets');
    } else if (smTxRatio > 0.6 && smVolRatio > 0.55) {
      score = 75;
      signals.push('moderate smart money inflow');
    } else if (smTxRatio > 0.55 && netSmartMoneyFlow > 0) {
      score = 65;
      signals.push('slight smart money inflow');
    } else if (smTxRatio < 0.35 && smVolRatio < 0.4) {
      score = 25;
      signals.push('smart money distributing');
    } else if (smTxRatio < 0.45 && netSmartMoneyFlow < 0) {
      score = 35;
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
      },
    };
  }
}
