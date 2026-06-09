import { BaseEngine } from './baseEngine.js';
import type { EngineResult } from './baseEngine.js';
import { TxMomentumEngine } from './txMomentumEngine.js';
import { LiquidityStabilityEngine } from './liquidityStabilityEngine.js';
import { SmartMoneyConvictionEngine } from './smartMoneyConvictionEngine.js';
import { CapitalInflowEngine } from './capitalInflowEngine.js';
import { HolderGrowthEngine } from './holderGrowthEngine.js';
import { NarrativeEngineV2 } from './narrativeEngineV2.js';
import { FeeAprPredictionEngine } from './feeAprPredictionEngine.js';
import { LiquidityUtilizationEngine } from './liquidityUtilizationEngine.js';
import { SmartLPEngine } from './smartLPEngine.js';
import { RangeEfficiencyEngine } from './rangeEfficiencyEngine.js';
import { RiskEngineV2 } from './riskEngineV2.js';
import { LpMomentumEngine } from './lpMomentumEngine.js';

interface LpAlphaWeights {
  feeAprPrediction: number;
  liquidityUtilization: number;
  txMomentum: number;
  capitalInflow: number;
  liquidityStability: number;
  smartMoney: number;
  smartLP: number;
  rangeEfficiency: number;
  holderGrowth: number;
  narrative: number;
  risk: number;
  lpMomentum: number;
}

interface LpAlphaResult {
  score: number;
  confidence: number;
  componentScores: Record<string, number>;
  reasons: string[];
}

export class LpAlphaScoreEngine extends BaseEngine {
  readonly name = 'lp_alpha_score';
  readonly version = '2.0.0';

  private weights: LpAlphaWeights = {
    feeAprPrediction: 0.18,
    liquidityUtilization: 0.14,
    txMomentum: 0.09,
    capitalInflow: 0.09,
    liquidityStability: 0.09,
    smartMoney: 0.09,
    smartLP: 0.09,
    rangeEfficiency: 0.04,
    holderGrowth: 0.04,
    narrative: 0.03,
    risk: 0.02,
    lpMomentum: 0.10,
  };

  private engines: Record<string, BaseEngine> = {
    txMomentum: new TxMomentumEngine(),
    liquidityStability: new LiquidityStabilityEngine(),
    smartMoney: new SmartMoneyConvictionEngine(),
    capitalInflow: new CapitalInflowEngine(),
    holderGrowth: new HolderGrowthEngine(),
    narrative: new NarrativeEngineV2(),
    feeAprPrediction: new FeeAprPredictionEngine(),
    liquidityUtilization: new LiquidityUtilizationEngine(),
    smartLP: new SmartLPEngine(),
    rangeEfficiency: new RangeEfficiencyEngine(),
    risk: new RiskEngineV2(),
    lpMomentum: new LpMomentumEngine(),
  };

  setWeights(weights: Partial<LpAlphaWeights>): void {
    Object.assign(this.weights, weights);
    const total = Object.values(this.weights).reduce((s, w) => s + w, 0);
    if (Math.abs(total - 1.0) > 0.001) {
      throw new Error(`Weights must sum to 1.0, got ${total}`);
    }
  }

  async evaluate(params?: {
    poolAddress?: string;
    tokenMint?: string;
    tokenName?: string;
    tokenSymbol?: string;
    narrative?: string;
    activeBin?: number;
    lowerBin?: number;
    upperBin?: number;
    binStep?: number;
    marketCap?: number;
    tokenAgeHours?: number;
    activeLPs?: string[];
    priceChanges?: number[];
  }): Promise<EngineResult> {
    if (!params?.poolAddress || !params?.tokenMint) {
      return { score: 0, signal: 'bearish', reason: 'Missing poolAddress or tokenMint', metadata: {} };
    }

    const { poolAddress, tokenMint } = params;
    const results = await Promise.allSettled([
      this.engines.feeAprPrediction.evaluate({ poolAddress, tokenMint }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.liquidityUtilization.evaluate({ poolAddress }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.txMomentum.evaluate({ poolAddress, tokenMint }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.capitalInflow.evaluate({ poolAddress, tokenMint }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.liquidityStability.evaluate({ poolAddress }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.smartMoney.evaluate({ poolAddress, tokenMint }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.smartLP.evaluate({ poolAddress, activeLPs: params.activeLPs }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.rangeEfficiency.evaluate({ poolAddress, activeBin: params.activeBin, lowerBin: params.lowerBin, upperBin: params.upperBin, binStep: params.binStep }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.holderGrowth.evaluate({ tokenMint }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.narrative.evaluate({ tokenName: params.tokenName, tokenSymbol: params.tokenSymbol, narrative: params.narrative }).catch(() => ({ score: 0, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.risk.evaluate({ poolAddress, tokenMint, tokenAgeHours: params.tokenAgeHours, marketCap: params.marketCap }).catch(() => ({ score: 50, signal: 'neutral' as const, reason: '', metadata: {} })),
      this.engines.lpMomentum.evaluate({ poolAddress, tokenMint, priceChanges: params.priceChanges }).catch(() => ({ score: 50, signal: 'neutral' as const, reason: '', metadata: {} })),
    ]);

    const getScore = (result: PromiseSettledResult<EngineResult>, defaultScore = 0): number => {
      if (result.status === 'fulfilled') return result.value.score;
      return defaultScore;
    };

    const feeAprScore = getScore(results[0]);
    const utilizationScore = getScore(results[1]);
    const txScore = getScore(results[2]);
    const inflowScore = getScore(results[3]);
    const stabilityScore = getScore(results[4]);
    const smartMoneyScore = getScore(results[5]);
    const smartLPScore = getScore(results[6]);
    const rangeScore = getScore(results[7]);
    const holderScore = getScore(results[8]);
    const narrativeScore = getScore(results[9]);
    const riskScore = getScore(results[10], 50);
    const lpMomentumScore = getScore(results[11], 50);

    const componentScores: Record<string, number> = {
      feeAprPrediction: feeAprScore,
      liquidityUtilization: utilizationScore,
      txMomentum: txScore,
      capitalInflow: inflowScore,
      liquidityStability: stabilityScore,
      smartMoney: smartMoneyScore,
      smartLP: smartLPScore,
      rangeEfficiency: rangeScore,
      holderGrowth: holderScore,
      narrative: narrativeScore,
      risk: riskScore,
      lpMomentum: lpMomentumScore,
    };

    const rawScore =
      feeAprScore * this.weights.feeAprPrediction +
      utilizationScore * this.weights.liquidityUtilization +
      txScore * this.weights.txMomentum +
      inflowScore * this.weights.capitalInflow +
      stabilityScore * this.weights.liquidityStability +
      smartMoneyScore * this.weights.smartMoney +
      smartLPScore * this.weights.smartLP +
      rangeScore * this.weights.rangeEfficiency +
      holderScore * this.weights.holderGrowth +
      narrativeScore * this.weights.narrative +
      (100 - riskScore) * this.weights.risk +
      lpMomentumScore * this.weights.lpMomentum;

    const score = this.normalizeScore(rawScore);
    const confidence = this.calculateConfidence(results);

    const reasons = this.buildReasons(results);

    return {
      score,
      signal: this.getSignal(score),
      reason: `LP Alpha Score: ${score.toFixed(2)} (confidence: ${confidence.toFixed(1)}%)`,
      metadata: { ...componentScores, confidence, rawScore },
    };
  }

  private calculateConfidence(results: PromiseSettledResult<EngineResult>[]): number {
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    return (fulfilled / results.length) * 100;
  }

  private buildReasons(results: PromiseSettledResult<EngineResult>[]): string[] {
    const reasons: string[] = [];
    const labels = [
      'Fee APR', 'Utilization', 'TX Momentum', 'Capital Inflow',
      'Liquidity Stability', 'Smart Money', 'Smart LP', 'Range Efficiency',
      'Holder Growth', 'Narrative', 'Risk', 'LP Momentum',
    ];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value.reason) {
        reasons.push(`${labels[i]}: ${result.value.reason}`);
      }
    }
    return reasons;
  }

  getEngines(): Record<string, BaseEngine> {
    return this.engines;
  }
}
