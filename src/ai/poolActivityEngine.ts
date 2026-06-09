import { BaseEngine } from '../engines/baseEngine.js';
import { repositories } from '../repositories/index.js';
import type { PoolActivityLevel } from '../types/index.js';

export class PoolActivityEngine extends BaseEngine {
  readonly name = 'PoolActivityEngine';
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
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: { activityLevel: 'DEAD' } };
    }

    const [marketData, liquidityData] = await Promise.all([
      repositories.market.getLatest(poolAddress),
      repositories.liquidity.getLatest(poolAddress),
    ]);

    const tx5m = marketData?.txCount5m ?? 0;
    const tx15m = marketData?.txCount15m ?? 0;
    const tx1h = marketData?.txCount1h ?? 0;
    const volume5m = marketData?.volume5m ?? 0;
    const volume1h = marketData?.volume1h ?? 0;
    const uniqueTraders = marketData?.uniqueTraders5m ?? 0;
    const tvl = liquidityData?.tvl ?? 0;

    const txVelocity5m = tx5m / 5;
    const txVelocity1h = tx1h / 60;
    const volumeVelocity = volume5m > 0 ? volume5m / 5 : 0;
    const traderActivity = uniqueTraders > 0 ? uniqueTraders : 0;

    const recentTxData = await repositories.transaction.getRecent(poolAddress, 15);
    const recentTxs = recentTxData.length;

    let activityLevel: PoolActivityLevel = 'DEAD';
    let score = 0;

    if (txVelocity5m > 6 || volumeVelocity > 40000 || recentTxs > 100) {
      activityLevel = 'VERY_ACTIVE';
      score = 95;
    } else if (txVelocity5m > 2 || volumeVelocity > 10000 || recentTxs > 40) {
      activityLevel = 'ACTIVE';
      score = 75;
    } else if (txVelocity5m > 0.5 || volumeVelocity > 1000 || recentTxs > 10) {
      activityLevel = 'NORMAL';
      score = 50;
    } else if (txVelocity5m > 0.05 || volumeVelocity > 50 || recentTxs > 0) {
      activityLevel = 'LOW';
      score = 25;
    } else {
      activityLevel = 'DEAD';
      score = 5;
    }

    const tvlRatio = tvl > 0 ? volume1h / tvl : 0;

    return {
      score: this.normalizeScore(score),
      signal: score >= 70 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
      reason: `Pool activity level: ${activityLevel} (tx5m=${tx5m}, vol5m=${volume5m}, traders=${traderActivity})`,
      metadata: {
        activityLevel,
        txPerMin5m: Number(txVelocity5m.toFixed(2)),
        txPerMin1h: Number(txVelocity1h.toFixed(2)),
        volumePerSec5m: Number(volumeVelocity.toFixed(2)),
        uniqueTraders5m: traderActivity,
        tvlVolumeRatio: Number(tvlRatio.toFixed(4)),
        recentTransactions15m: recentTxs,
      },
    };
  }
}
