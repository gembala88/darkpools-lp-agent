import { BaseEngine, EngineResult } from './baseEngine.js';
import { TransactionData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export class RangeEfficiencyEngine extends BaseEngine {
  readonly name = 'range_efficiency';
  readonly version = '1.0.0';

  async evaluate(params?: {
    poolAddress?: string;
    activeBin?: number;
    lowerBin?: number;
    upperBin?: number;
    binStep?: number;
  }): Promise<EngineResult> {
    const { poolAddress, activeBin, lowerBin, upperBin, binStep = 80 } = params ?? {};
    if (!poolAddress || activeBin == null || lowerBin == null || upperBin == null) {
      return { score: 0, signal: 'neutral', reason: 'Missing position data', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const totalBins = upperBin - lowerBin;
    const currentPriceMovement = Math.abs(activeBin - lowerBin) / Math.max(1, totalBins);
    const inRange = activeBin >= lowerBin && activeBin <= upperBin;

    const latestMarket = await repositories.market.getLatest(poolAddress);
    const volume24h = latestMarket?.volume24h ?? 0;
    const latestLiquidity = await repositories.liquidity.getLatest(poolAddress);
    const tvl = latestLiquidity?.tvl ?? 1;

    const capitalEfficiency = tvl > 0 ? volume24h / tvl : 0;
    const recentTxs = await repositories.transaction.getRecent(poolAddress, 60);
    const feesGenerated = recentTxs.reduce((s: number, t: TransactionData) => s + t.volumeUsd * 0.003, 0);
    const feeEfficiency = tvl > 0 ? feesGenerated / tvl : 0;

    metadata.totalBins = totalBins;
    metadata.priceMovement = currentPriceMovement;
    metadata.inRange = inRange;
    metadata.capitalEfficiency = capitalEfficiency;
    metadata.feeEfficiency = feeEfficiency;

    const rangeScore = inRange ? 30 : Math.max(0, 30 - (currentPriceMovement * 30));
    const capitalScore = Math.min(capitalEfficiency * 10, 30);
    const feeScore = Math.min(feeEfficiency * 100, 25);
    const widthScore = totalBins >= 35 && totalBins <= 200 ? 15 : totalBins > 200 ? 5 : 10;

    const score = this.normalizeScore(rangeScore + capitalScore + feeScore + widthScore);

    return {
      score,
      signal: this.getSignal(score),
      reason: `inRange=${inRange}, capEff=${capitalEfficiency.toFixed(4)}, feeEff=${feeEfficiency.toFixed(4)}`,
      metadata,
    };
  }
}
