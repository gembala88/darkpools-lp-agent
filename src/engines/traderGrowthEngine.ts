import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export class TraderGrowthEngine extends BaseEngine {
  readonly name = 'trader_growth';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress;
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const timeframes = [5, 15, 60, 240];
    const metadata: Record<string, unknown> = {};

    let growthScore = 0;
    for (const min of timeframes) {
      const traders = await repositories.transaction.getUniqueTraders(poolAddress, min);
      metadata[`uniqueTraders${min}m`] = traders;
    }

    const traders5m = metadata['uniqueTraders5m'] as number ?? 0;
    const traders15m = metadata['uniqueTraders15m'] as number ?? 0;
    const traders1h = metadata['uniqueTraders1h'] as number ?? 0;
    const traders4h = metadata['uniqueTraders4h'] as number ?? 0;

    let shortTermGrowth = 0;
    let mediumTermGrowth = 0;
    let longTermGrowth = 0;

    if (traders15m > 0 && traders5m > 0) {
      shortTermGrowth = ((traders15m - traders5m) / traders5m) * 100;
      metadata.shortTermGrowth5to15 = shortTermGrowth;
    }
    if (traders1h > 0 && traders15m > 0) {
      mediumTermGrowth = ((traders1h - traders15m) / traders15m) * 100;
      metadata.mediumTermGrowth15to60 = mediumTermGrowth;
    }
    if (traders4h > 0 && traders1h > 0) {
      longTermGrowth = ((traders4h - traders1h) / traders1h) * 100;
      metadata.longTermGrowth1to4h = longTermGrowth;
    }

    if (shortTermGrowth < 0 && mediumTermGrowth < 0) {
      return { score: 0, signal: 'bearish', reason: 'Negative trader growth across timeframes - REJECTED', metadata };
    }

    growthScore = (
      (Math.max(0, shortTermGrowth) * 0.5) +
      (Math.max(0, mediumTermGrowth) * 0.3) +
      (Math.max(0, longTermGrowth) * 0.2)
    );

    const traderVolume = traders5m + traders15m + traders1h;
    const volumeBonus = traderVolume > 100 ? 20 : traderVolume > 50 ? 10 : 0;
    const score = this.normalizeScore(Math.min(growthScore + volumeBonus, 100));

    return { score, signal: this.getSignal(score), reason: `traders 5m=${traders5m}, 15m=${traders15m}, 1h=${traders1h}`, metadata };
  }
}
