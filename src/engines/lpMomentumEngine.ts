import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export class LpMomentumEngine extends BaseEngine {
  readonly name = 'lp_momentum';
  readonly version = '1.0.0';

  private readonly lpMomentumWeights = {
    feeTvlRatio: 0.25,
    volumeAcceleration: 0.20,
    txMomentum: 0.15,
    priceChange: 0.15,
    liquidityStability: 0.10,
    capitalInflow: 0.10,
    holderGrowth: 0.05,
  };

  async evaluate(params?: {
    poolAddress?: string;
    tokenMint?: string;
    priceChanges?: number[];
  }): Promise<EngineResult> {
    const { poolAddress, tokenMint, priceChanges } = params ?? {};
    if (!poolAddress || !tokenMint) {
      return { score: 0, signal: 'bearish', reason: 'Missing poolAddress or tokenMint', metadata: {} };
    }

    const [
      feeTvlScore,
      volumeAccelScore,
      txMomScore,
      priceChangeScore,
      liqStabilityScore,
      capInflowScore,
      holderGrowthScore,
    ] = await Promise.all([
      this.evaluateFeeTvlRatio(poolAddress),
      this.evaluateVolumeAcceleration(poolAddress),
      this.evaluateTxMomentum(poolAddress),
      this.evaluatePriceChange(priceChanges),
      this.evaluateLiquidityStability(poolAddress),
      this.evaluateCapitalInflow(poolAddress, tokenMint),
      this.evaluateHolderGrowth(tokenMint),
    ]);

    const subScores: Record<string, number> = {
      feeTvlScore,
      volumeAccelerationScore: volumeAccelScore,
      txMomentumScore: txMomScore,
      priceChangeScore,
      liquidityStabilityScore: liqStabilityScore,
      capitalInflowScore: capInflowScore,
      holderGrowthScore,
    };

    const hasCriticalReject = Object.entries(subScores).some(([, v]) => v < 0);
    if (hasCriticalReject) {
      const rejectReason = Object.entries(subScores)
        .filter(([, v]) => v < 0)
        .map(([k]) => k)
        .join(', ');
      return { score: 0, signal: 'bearish', reason: `LP Momentum REJECTED: ${rejectReason}`, metadata: subScores };
    }

    const rawScore =
      subScores.feeTvlScore * this.lpMomentumWeights.feeTvlRatio +
      subScores.volumeAccelerationScore * this.lpMomentumWeights.volumeAcceleration +
      subScores.txMomentumScore * this.lpMomentumWeights.txMomentum +
      subScores.priceChangeScore * this.lpMomentumWeights.priceChange +
      subScores.liquidityStabilityScore * this.lpMomentumWeights.liquidityStability +
      subScores.capitalInflowScore * this.lpMomentumWeights.capitalInflow +
      subScores.holderGrowthScore * this.lpMomentumWeights.holderGrowth;

    const score = this.normalizeScore(rawScore);

    return {
      score,
      signal: this.getSignal(score),
      reason: `LP Momentum: ${score.toFixed(2)} (feeTvl=${feeTvlScore}, volAccel=${volumeAccelScore}, txMom=${txMomScore})`,
      metadata: { ...subScores, lpMomentumScore: score },
    };
  }

  private async evaluateFeeTvlRatio(poolAddress: string): Promise<number> {
    const latestLiquidity = await repositories.liquidity.getLatest(poolAddress);
    const tvl = latestLiquidity?.tvl ?? 1;
    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);
    const fees1h = txs1h.reduce((sum: number, tx) => sum + tx.volumeUsd * 0.003, 0);
    const feeTvlRatio = tvl > 0 ? (fees1h / tvl) * 100 : 0;

    if (feeTvlRatio >= 1.0) return 100;
    if (feeTvlRatio >= 0.5) return 85;
    if (feeTvlRatio >= 0.25) return 70;
    if (feeTvlRatio >= 0.10) return 50;
    if (feeTvlRatio >= 0.05) return 30;
    return feeTvlRatio > 0 ? 10 : 0;
  }

  private async evaluateVolumeAcceleration(poolAddress: string): Promise<number> {
    const txs5m = await repositories.transaction.getRecent(poolAddress, 5);
    const txs15m = await repositories.transaction.getRecent(poolAddress, 15);
    const txs30m = await repositories.transaction.getRecent(poolAddress, 30);
    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);

    const vol5m = txs5m.reduce((s: number, t) => s + t.volumeUsd, 0);
    const vol15m = txs15m.reduce((s: number, t) => s + t.volumeUsd, 0);
    const vol30m = txs30m.reduce((s: number, t) => s + t.volumeUsd, 0);
    const vol1h = txs1h.reduce((s: number, t) => s + t.volumeUsd, 0);

    const growth5to15 = vol5m > 0 ? ((vol15m / 3) - vol5m) / vol5m * 100 : 0;
    const growth15to30 = vol15m > 0 ? ((vol30m / 2) - vol15m) / vol15m * 100 : 0;
    const growth30to60 = vol30m > 0 ? (vol1h - (vol30m * 2)) / (vol30m * 2) * 100 : 0;

    const avgGrowth = (growth5to15 + growth15to30 + growth30to60) / 3;

    if (avgGrowth >= 100) return 30;
    if (avgGrowth >= 50) return 25;
    if (avgGrowth >= 25) return 20;
    if (avgGrowth >= 10) return 10;
    if (avgGrowth > 0) return 5;
    return 0;
  }

  private async evaluateTxMomentum(poolAddress: string): Promise<number> {
    const txs5m = await repositories.transaction.getRecent(poolAddress, 5);
    const txs15m = await repositories.transaction.getRecent(poolAddress, 15);
    const txs30m = await repositories.transaction.getRecent(poolAddress, 30);
    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);

    const count5m = txs5m.length;
    const count15m = txs15m.length;
    const count30m = txs30m.length;
    const count1h = txs1h.length;

    const velocity5 = count5m / 5;
    const velocity15 = count15m / 15;
    const velocity30 = count30m / 30;
    const velocity60 = count1h / 60;

    const accel5to15 = velocity5 > 0 ? (velocity15 - velocity5) / velocity5 * 100 : 0;
    const accel15to30 = velocity15 > 0 ? (velocity30 - velocity15) / velocity15 * 100 : 0;
    const accel30to60 = velocity30 > 0 ? (velocity60 - velocity30) / velocity30 * 100 : 0;

    const avgAccel = (accel5to15 + accel15to30 + accel30to60) / 3;
    const avgVelocity = (velocity5 + velocity15 + velocity30 + velocity60) / 4;

    if (avgAccel < -50) return 0;
    if (avgAccel < -20) return 20;

    const velocityScore = Math.min(avgVelocity * 20, 40);
    const accelScore = avgAccel > 50 ? 40 : avgAccel > 20 ? 30 : avgAccel > 0 ? 20 : 10;
    const trendScore = count1h > count30m * 2 ? 20 : count1h > count30m ? 10 : 5;

    return Math.min(velocityScore + accelScore + trendScore, 100);
  }

  private async evaluatePriceChange(priceChanges?: number[]): Promise<number> {
    if (!priceChanges || priceChanges.length < 2) return 50;

    const first = priceChanges[0];
    const last = priceChanges[priceChanges.length - 1];
    const totalChange = first > 0 ? ((last - first) / first) * 100 : 0;

    if (totalChange < -20) return 0;
    if (totalChange < -10) return 20;
    if (totalChange < -5) return 40;
    if (totalChange < 0) return 50;
    if (totalChange < 5) return 55;
    if (totalChange < 10) return 65;
    if (totalChange < 20) return 80;
    if (totalChange < 50) return 90;
    return 100;
  }

  private async evaluateLiquidityStability(poolAddress: string): Promise<number> {
    const now = Date.now();
    const snapshots30m = await repositories.liquidity.getAggregated(poolAddress, 30);
    const snapshots1h = await repositories.liquidity.getAggregated(poolAddress, 60);
    const snapshots4h = await repositories.liquidity.getAggregated(poolAddress, 240);

    const drain30m = snapshots30m.changePercent;
    const drain1h = snapshots1h.changePercent;
    const drain4h = snapshots4h.changePercent;

    if (drain30m < -40 || drain1h < -40) return -1;
    if (drain30m < -20 || drain1h < -20) return -1;

    if (drain30m > 0 && drain1h > 0) return 100;
    if (drain30m > -5 && drain1h > -5) return 85;
    if (drain30m > -10 && drain1h > -10) return 65;
    if (drain30m > -15 && drain1h > -15) return 40;
    return 20;
  }

  private async evaluateCapitalInflow(poolAddress: string, tokenMint: string): Promise<number> {
    const txs30m = await repositories.transaction.getRecent(poolAddress, 30);
    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);

    const vol30m = txs30m.reduce((s: number, t) => s + t.volumeUsd, 0);
    const vol1h = txs1h.reduce((s: number, t) => s + t.volumeUsd, 0);

    const holders = await repositories.holder.getByToken(tokenMint);
    const newHolders1h = holders.filter(h =>
      h.firstSeen.getTime() >= Date.now() - 3600_000
    ).length;

    const liquidityChange = await repositories.liquidity.getAggregated(poolAddress, 60);
    const newLiquidity = Math.max(0, liquidityChange.change);

    let score = 0;
    if (vol1h > 0) score = Math.min(vol1h / 5000 * 25, 25);
    if (vol30m > vol1h * 0.6) score += 15;

    score += Math.min(newHolders1h * 5, 30);
    score += Math.min(newLiquidity / 1000 * 20, 20);
    score += txs30m.length > 0 ? 10 : 0;

    return Math.min(score, 100);
  }

  private async evaluateHolderGrowth(tokenMint: string): Promise<number> {
    const holders = await repositories.holder.getByToken(tokenMint);
    const now = Date.now();

    const new5m = holders.filter(h => h.firstSeen.getTime() >= now - 300_000).length;
    const new15m = holders.filter(h => h.firstSeen.getTime() >= now - 900_000).length;
    const new1h = holders.filter(h => h.firstSeen.getTime() >= now - 3600_000).length;
    const new4h = holders.filter(h => h.firstSeen.getTime() >= now - 14400_000).length;

    if (holders.length === 0) return 0;

    const growth5m = (new5m / holders.length) * 100;
    const growth15m = (new15m / holders.length) * 100;
    const growth1h = (new1h / holders.length) * 100;
    const growth4h = (new4h / holders.length) * 100;

    const weightedGrowth = growth5m * 0.3 + growth15m * 0.3 + growth1h * 0.25 + growth4h * 0.15;
    const baseScore = Math.min(weightedGrowth * 5, 60);
    const volumeBonus = new1h > 10 ? 20 : new1h > 5 ? 10 : 0;
    const consistencyBonus = (new5m > 0 && new15m > 0 && new1h > 0) ? 20 : 0;

    return Math.min(baseScore + volumeBonus + consistencyBonus, 100);
  }
}
