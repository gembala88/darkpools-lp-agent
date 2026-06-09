import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export class LiquidityStabilityEngine extends BaseEngine {
  readonly name = 'liquidity_stability';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress;
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const timeframes = [30, 60, 240];
    const metadata: Record<string, unknown> = {};
    let worstDrain = 0;

    for (const min of timeframes) {
      const aggregated = await repositories.liquidity.getAggregated(poolAddress, min);
      metadata[`liquidityChange${min}m`] = aggregated.changePercent;

      if (aggregated.changePercent < worstDrain) {
        worstDrain = aggregated.changePercent;
      }

      if (aggregated.changePercent < -40) {
        return {
          score: 0,
          signal: 'bearish',
          reason: `Critical liquidity drain ${aggregated.changePercent.toFixed(1)}% (>40%) over ${min}m - REJECTED`,
          metadata,
        };
      }

      if (aggregated.changePercent < -20) {
        return {
          score: 0,
          signal: 'bearish',
          reason: `Liquidity drain ${aggregated.changePercent.toFixed(1)}% (>20%) over ${min}m - REJECTED`,
          metadata,
        };
      }
    }

    const totalLiquidity = Number(metadata['liquidityChange30m'] ?? 0) +
      Number(metadata['liquidityChange60m'] ?? 0) +
      Number(metadata['liquidityChange240m'] ?? 0);

    let stabilityBonus = 0;
    if (worstDrain > -5) stabilityBonus = 30;
    else if (worstDrain > -10) stabilityBonus = 20;
    else if (worstDrain > -15) stabilityBonus = 10;

    const growthScore = Math.max(0, totalLiquidity * 0.5) + stabilityBonus;
    const score = this.normalizeScore(Math.min(growthScore, 100));

    return {
      score,
      signal: this.getSignal(score),
      reason: `worst drain=${worstDrain.toFixed(1)}%, totalChange=${totalLiquidity.toFixed(1)}%`,
      metadata,
    };
  }
}
