import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export class LiquidityUtilizationEngine extends BaseEngine {
  readonly name = 'liquidity_utilization';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress;
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const latestLiquidity = await repositories.liquidity.getLatest(poolAddress);
    const liquidity = latestLiquidity?.liquidity ?? 1;
    const tvl = latestLiquidity?.tvl ?? 1;

    const latestMarket = await repositories.market.getLatest(poolAddress);
    const volume24h = latestMarket?.volume24h ?? 0;

    const volume5m = latestMarket?.volume5m ?? 0;
    const volumeToLiquidity = liquidity > 0 ? volume24h / liquidity : 0;
    const volumeToTvl = tvl > 0 ? volume24h / tvl : 0;

    metadata.volumeToLiquidity = volumeToLiquidity;
    metadata.volumeToTvl = volumeToTvl;
    metadata.liquidity = liquidity;
    metadata.volume24h = volume24h;

    if (volumeToLiquidity < 0.01 && volumeToTvl < 0.01) {
      return { score: 0, signal: 'bearish', reason: 'Extremely low utilization - REJECTED', metadata };
    }

    let score = 0;
    if (volumeToTvl > 5) score = 90;
    else if (volumeToTvl > 2) score = 70;
    else if (volumeToTvl > 1) score = 50;
    else if (volumeToTvl > 0.5) score = 30;
    else if (volumeToTvl > 0.1) score = 15;
    else score = 5;

    const bonus = volume5m > 0 ? 10 : 0;
    const finalScore = this.normalizeScore(score + bonus);

    return {
      score: finalScore,
      signal: this.getSignal(finalScore),
      reason: `vol/liquidity=${volumeToLiquidity.toFixed(4)}, vol/tvl=${volumeToTvl.toFixed(4)}`,
      metadata,
    };
  }
}
