import { BaseEngine } from '../engines/baseEngine.js';
import type { MarketRegime } from '../types/index.js';

export interface AIWeights {
  marketRegime: number;
  poolActivity: number;
  accumulation: number;
  whaleExit: number;
  smartMoneyFlow: number;
  candleIntelligence: number;
  marketPsychology: number;
  selfLearning: number;
  deploymentMemory: number;
}

const DEFAULT_WEIGHTS: AIWeights = {
  marketRegime: 0.15,
  poolActivity: 0.10,
  accumulation: 0.15,
  whaleExit: 0.10,
  smartMoneyFlow: 0.15,
  candleIntelligence: 0.10,
  marketPsychology: 0.10,
  selfLearning: 0.05,
  deploymentMemory: 0.10,
};

const REGIME_WEIGHTS: Partial<Record<MarketRegime, Partial<AIWeights>>> = {
  ACCUMULATION: { accumulation: 0.25, smartMoneyFlow: 0.20, marketRegime: 0.10 },
  TRENDING_BULLISH: { candleIntelligence: 0.20, marketRegime: 0.20, smartMoneyFlow: 0.15 },
  TRENDING_BEARISH: { whaleExit: 0.25, marketPsychology: 0.20, candleIntelligence: 0.15 },
  RANGING: { poolActivity: 0.20, accumulation: 0.20, marketRegime: 0.10 },
  DISTRIBUTION: { whaleExit: 0.25, smartMoneyFlow: 0.20, marketPsychology: 0.15 },
  PANIC: { whaleExit: 0.30, marketPsychology: 0.20, smartMoneyFlow: 0.15 },
  EUPHORIA: { marketPsychology: 0.25, marketRegime: 0.20, smartMoneyFlow: 0.15 },
};

export class DynamicWeightEngine extends BaseEngine {
  readonly name = 'DynamicWeightEngine';
  readonly version = '1.0.0';

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const marketRegime = (params?.marketRegime as MarketRegime) ?? 'RANGING';
    const confidence = Number(params?.confidence ?? 80);

    const baseWeights = { ...DEFAULT_WEIGHTS };
    const regimeOverrides = REGIME_WEIGHTS[marketRegime];

    if (regimeOverrides) {
      for (const [key, value] of Object.entries(regimeOverrides)) {
        (baseWeights as Record<string, number>)[key] = value;
      }
    }

    const totalWeight = Object.values(baseWeights).reduce((s, w) => s + w, 0);
    if (totalWeight > 0) {
      for (const key of Object.keys(baseWeights)) {
        (baseWeights as Record<string, number>)[key] /= totalWeight;
      }
    }

    return {
      score: this.normalizeScore(confidence),
      signal: 'neutral',
      reason: `Dynamic weights calculated for ${marketRegime} regime`,
      metadata: {
        weights: baseWeights,
        marketRegime,
        regimeApplied: !!regimeOverrides,
      },
    };
  }
}
