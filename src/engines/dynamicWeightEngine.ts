import { BaseEngine, EngineResult } from './baseEngine.js';
import type { MarketRegime } from '../types/index.js';

export interface EngineWeights {
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

const BASE_WEIGHTS: EngineWeights = {
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

const REGIME_ADJUSTMENTS: Partial<Record<MarketRegime, Partial<EngineWeights>>> = {
  ACCUMULATION: {
    smartMoney: 0.15,
    capitalInflow: 0.15,
    txMomentum: 0.04,
    feeAprPrediction: 0.10,
  },
  TRENDING_BULLISH: {
    txMomentum: 0.15,
    feeAprPrediction: 0.22,
    risk: 0.01,
    liquidityUtilization: 0.10,
  },
  TRENDING_BEARISH: {
    risk: 0.06,
    liquidityStability: 0.15,
    txMomentum: 0.04,
    feeAprPrediction: 0.12,
    narrative: 0.05,
  },
  RANGING: {
    feeAprPrediction: 0.22,
    liquidityUtilization: 0.18,
    txMomentum: 0.05,
    capitalInflow: 0.06,
  },
  DISTRIBUTION: {
    risk: 0.08,
    liquidityStability: 0.15,
    smartMoney: 0.04,
    capitalInflow: 0.05,
    liquidityUtilization: 0.08,
  },
  PANIC: {
    risk: 0.12,
    liquidityStability: 0.12,
    feeAprPrediction: 0.08,
    txMomentum: 0.03,
    smartMoney: 0.04,
    capitalInflow: 0.04,
    narrative: 0.01,
    lpMomentum: 0.04,
    holderGrowth: 0.02,
  },
  EUPHORIA: {
    risk: 0.08,
    txMomentum: 0.04,
    feeAprPrediction: 0.12,
    liquidityStability: 0.12,
  },
};

export class DynamicWeightEngine extends BaseEngine {
  readonly name = 'dynamic_weight';
  readonly version = '2.0.0';

  async evaluate(params?: {
    marketRegime?: MarketRegime;
    confidence?: number;
  }): Promise<EngineResult & { metadata: { weights: EngineWeights; marketRegime: MarketRegime } }> {
    const marketRegime = (params?.marketRegime ?? 'RANGING') as MarketRegime;
    const confidence = Number(params?.confidence ?? 80);

    const weights = { ...BASE_WEIGHTS };
    const adjustments = REGIME_ADJUSTMENTS[marketRegime];

    if (adjustments) {
      for (const [key, value] of Object.entries(adjustments)) {
        (weights as Record<string, number>)[key] = value as number;
      }
    }

    const total = Object.values(weights).reduce((s, w) => s + w, 0);
    if (total > 0) {
      for (const key of Object.keys(weights)) {
        (weights as Record<string, number>)[key] /= total;
      }
    }

    return {
      score: this.normalizeScore(confidence),
      signal: 'neutral',
      reason: `Dynamic weights for ${marketRegime}`,
      metadata: {
        weights,
        marketRegime,
        regimeApplied: !!adjustments,
      },
    };
  }

  getBaseWeights(): EngineWeights {
    return { ...BASE_WEIGHTS };
  }
}
