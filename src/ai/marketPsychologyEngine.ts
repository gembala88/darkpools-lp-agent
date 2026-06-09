import { BaseEngine } from '../engines/baseEngine.js';
import { repositories } from '../repositories/index.js';
import type { MarketPsychology } from '../types/index.js';

export class MarketPsychologyEngine extends BaseEngine {
  readonly name = 'MarketPsychologyEngine';
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
      return { score: 50, signal: 'neutral', reason: 'No pool address', metadata: { psychology: 'NEUTRAL' } };
    }

    const [marketData, recentTxs] = await Promise.all([
      repositories.market.getLatest(tokenMint),
      repositories.transaction.getRecent(poolAddress, 60),
    ]);

    const price = marketData?.price ?? 0;

    const buyVol = recentTxs.filter(t => t.type === 'buy').reduce((s, t) => s + t.volumeUsd, 0);
    const sellVol = recentTxs.filter(t => t.type === 'sell').reduce((s, t) => s + t.volumeUsd, 0);
    const totalVol = buyVol + sellVol;
    const buyRatio = totalVol > 0 ? buyVol / totalVol : 0.5;

    const buyCount = recentTxs.filter(t => t.type === 'buy').length;
    const sellCount = recentTxs.filter(t => t.type === 'sell').length;
    const txTotal = buyCount + sellCount;
    const txBuyRatio = txTotal > 0 ? buyCount / txTotal : 0.5;

    const avgBuySize = buyCount > 0 ? buyVol / buyCount : 0;
    const avgSellSize = sellCount > 0 ? sellVol / sellCount : 0;
    const sizeRatio = avgSellSize > 0 ? avgBuySize / avgSellSize : 1;

    let psychology: MarketPsychology = 'NEUTRAL';
    let score = 50;
    const signals: string[] = [];

    if (buyRatio > 0.75 && txBuyRatio > 0.7 && sizeRatio > 1.5) {
      psychology = 'EUPHORIA';
      score = 90;
      signals.push('extreme greed: large buy orders dominating');
    } else if (buyRatio > 0.65 && txBuyRatio > 0.6) {
      psychology = 'GREED';
      score = 75;
      signals.push('greed: more buy volume than sell');
    } else if (buyRatio < 0.25 && txBuyRatio < 0.3 && sizeRatio < 0.7) {
      psychology = 'CAPITULATION';
      score = 10;
      signals.push('capitulation: overwhelming sell pressure');
    } else if (buyRatio < 0.35 && txBuyRatio < 0.4) {
      psychology = 'FEAR';
      score = 25;
      signals.push('fear: sell pressure dominating');
    } else if (buyRatio > 0.45 && buyRatio < 0.55) {
      psychology = 'NEUTRAL';
      score = 50;
      signals.push('balanced market psychology');
    }

    return {
      score: this.normalizeScore(score),
      signal: score >= 70 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'neutral market sentiment',
      metadata: {
        psychology,
        buyVolumeRatio: Number(buyRatio.toFixed(2)),
        txBuyRatio: Number(txBuyRatio.toFixed(2)),
        avgBuySize: Number(avgBuySize.toFixed(2)),
        avgSellSize: Number(avgSellSize.toFixed(2)),
        sizeRatio: Number(sizeRatio.toFixed(2)),
        price,
      },
    };
  }
}
