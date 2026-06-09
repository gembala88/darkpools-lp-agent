import { BaseEngine } from '../engines/baseEngine.js';
import { repositories } from '../repositories/index.js';

export class AccumulationDetector extends BaseEngine {
  readonly name = 'AccumulationDetector';
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

    const [marketData, recentTxs] = await Promise.all([
      repositories.market.getLatest(poolAddress),
      repositories.transaction.getRecent(poolAddress, 5),
    ]);

    const price = marketData?.price ?? 0;

    const buys = recentTxs.filter(t => t.type === 'buy');
    const sells = recentTxs.filter(t => t.type === 'sell');

    const buyTxCount = buys.length;
    const sellTxCount = sells.length;
    const totalTx = buyTxCount + sellTxCount;

    const buyVol = buys.reduce((s, t) => s + (t.volumeUsd ?? 0), 0);
    const sellVol = sells.reduce((s, t) => s + (t.volumeUsd ?? 0), 0);

    const txRatio = totalTx > 0 ? buyTxCount / totalTx : 0.5;
    const volRatio = (buyVol + sellVol) > 0 ? buyVol / (buyVol + sellVol) : 0.5;

    const smartMoneyBuys = buys.filter(t => t.isSmartMoney).length;
    const smartMoneySells = sells.filter(t => t.isSmartMoney).length;
    const netSmartMoney = smartMoneyBuys - smartMoneySells;

    const topHolders = repositories.holder.getTopHolders(tokenMint, 5);
    const topHolderConcentration = topHolders.reduce((s, h) => s + h.percentage, 0);
    const now = Date.now();
    const topHolderCountRecentlyActive = topHolders.filter(h => {
      const lastSeen = typeof h.lastSeen === 'string' ? new Date(h.lastSeen).getTime() : (h.lastSeen as unknown as number);
      return (now - lastSeen) < 3600000;
    }).length;

    let score = 50;
    const signals: string[] = [];

    if (txRatio > 0.65 && volRatio > 0.6 && netSmartMoney > 3) {
      score = 90;
      signals.push('strong accumulation with smart money leading');
    } else if (txRatio > 0.6 && volRatio > 0.55) {
      score = 75;
      signals.push('moderate accumulation pattern');
    } else if (txRatio > 0.55 && netSmartMoney > 0) {
      score = 65;
      signals.push('slight buy bias with smart money support');
    } else if (txRatio > 0.55) {
      score = 55;
      signals.push('slight buy bias');
    } else if (txRatio < 0.4) {
      score = 25;
      signals.push('distribution pattern detected');
    } else if (txRatio < 0.45 && volRatio < 0.4) {
      score = 35;
      signals.push('slight distribution pattern');
    } else {
      signals.push('neutral accumulation signal');
    }

    if (topHolderConcentration > 40 && topHolderCountRecentlyActive >= 3) {
      score = Math.min(95, score + 10);
      signals.push('top holders actively accumulating');
    }

    const normalizedScore = this.normalizeScore(score);
    return {
      score: normalizedScore,
      signal: normalizedScore >= 70 ? 'bullish' : normalizedScore < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'No clear accumulation signal',
      metadata: {
        buyTxRatio: Number(txRatio.toFixed(2)),
        buyVolRatio: Number(volRatio.toFixed(2)),
        netSmartMoneyTxs: netSmartMoney,
        topHolderConcentration: Number(topHolderConcentration.toFixed(2)),
        activeTopHolders: topHolderCountRecentlyActive,
        price,
      },
    };
  }
}
