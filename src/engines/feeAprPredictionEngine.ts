import { BaseEngine, EngineResult } from './baseEngine.js';
import { TransactionData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export class FeeAprPredictionEngine extends BaseEngine {
  readonly name = 'fee_apr_prediction';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string; tokenMint?: string }): Promise<EngineResult> {
    const { poolAddress, tokenMint } = params ?? {};
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const latestLiquidity = await repositories.liquidity.getLatest(poolAddress);
    const tvl = latestLiquidity?.tvl ?? 1;

    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);
    const fees1h = txs1h.reduce((sum: number, tx: TransactionData) => sum + (tx.volumeUsd * 0.003), 0);

    const txs24h = await repositories.transaction.getRecent(poolAddress, 1440);
    const fees24h = txs24h.reduce((sum: number, tx: TransactionData) => sum + (tx.volumeUsd * 0.003), 0);

    const currentApr24h = tvl > 0 ? (fees24h / tvl) * 365 * 100 : 0;
    const currentApr1h = tvl > 0 ? (fees1h / tvl) * 24 * 365 * 100 : 0;

    const latestMarket = await repositories.market.getLatest(poolAddress);
    const volumeTrend = latestMarket
      ? this.calculateTrend(latestMarket.volume1h, latestMarket.volume24h / 24)
      : 'stable';

    const txMomentum = repositories.market.getTransactionVelocity(poolAddress);
    const volume5m = latestMarket?.volume5m ?? 0;
    const volume1h = latestMarket?.volume1h ?? 0;

    const growthFactor = volumeTrend === 'up' ? 1.2 : volumeTrend === 'down' ? 0.8 : 1.0;
    const momentumFactor = txMomentum > 0 ? 1 + Math.min(txMomentum * 0.05, 0.3) : 1.0;

    const predictedApr24h = currentApr1h * growthFactor * momentumFactor;
    const predictedApr7d = currentApr24h * growthFactor * 0.9;

    metadata.currentApr24h = currentApr24h;
    metadata.currentApr1h = currentApr1h;
    metadata.predictedApr24h = predictedApr24h;
    metadata.predictedApr7d = predictedApr7d;
    metadata.volumeTrend = volumeTrend;
    metadata.momentumFactor = momentumFactor;

    const baseScore = Math.min((predictedApr24h / 100) * 50, 50);
    const consistencyScore = (fees1h > 0 && fees24h > 0) ? 20 : 0;
    const growthScore = volumeTrend === 'up' ? 20 : volumeTrend === 'stable' ? 10 : 0;
    const momentumBonus = Math.min(txMomentum * 5, 10);

    const score = this.normalizeScore(baseScore + consistencyScore + growthScore + momentumBonus);

    return {
      score,
      signal: this.getSignal(score),
      reason: `predictedAPR24h=${predictedApr24h.toFixed(2)}%, predictedAPR7d=${predictedApr7d.toFixed(2)}%, volumeTrend=${volumeTrend}`,
      metadata,
    };
  }
}
