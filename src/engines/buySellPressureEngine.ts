import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export class BuySellPressureEngine extends BaseEngine {
  readonly name = 'buy_sell_pressure';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress;
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const timeframes = [5, 15, 30, 60];
    const metadata: Record<string, unknown> = {};
    let bestRatio = 0;

    for (const min of timeframes) {
      const { buyVolume, sellVolume } = await repositories.transaction.getVolumeByType(poolAddress, min);
      const ratio = sellVolume > 0 ? buyVolume / sellVolume : buyVolume > 0 ? 99 : 1;
      metadata[`buySellRatio${min}m`] = ratio;
      metadata[`buyVolume${min}m`] = buyVolume;
      metadata[`sellVolume${min}m`] = sellVolume;

      if (ratio > bestRatio) bestRatio = ratio;

      if (ratio < 0.90 && min === 5) {
        return {
          score: 0,
          signal: 'bearish',
          reason: `buySellRatio ${ratio.toFixed(2)} < 0.90 - REJECTED`,
          metadata,
        };
      }
    }

    const weightedRatio = (bestRatio * 0.5 + (metadata['buySellRatio15m'] as number ?? 1) * 0.3 + (metadata['buySellRatio30m'] as number ?? 1) * 0.2);
    const score = this.normalizeScore(Math.min(weightedRatio * 50, 100));

    return {
      score,
      signal: this.getSignal(score),
      reason: `buySellRatio=${bestRatio.toFixed(2)}, buyPressure=${(metadata['buyVolume5m'] as number ?? 0).toFixed(2)}`,
      metadata,
    };
  }
}
