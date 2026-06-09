import { BaseEngine, EngineResult } from './baseEngine.js';

export type VolatilityCategory = 'Dead' | 'Low' | 'Healthy' | 'High' | 'Extreme';

export class VolatilityEngine extends BaseEngine {
  readonly name = 'volatility';
  readonly version = '1.0.0';

  async evaluate(params?: {
    priceChanges?: number[];
    volatilityScore?: number;
  }): Promise<EngineResult> {
    const { priceChanges = [], volatilityScore: explicitScore } = params ?? {};
    const metadata: Record<string, unknown> = {};

    let score: number;
    if (explicitScore != null) {
      score = explicitScore;
    } else if (priceChanges.length > 0) {
      const mean = priceChanges.reduce((s, p) => s + p, 0) / priceChanges.length;
      const variance = priceChanges.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / priceChanges.length;
      score = Math.sqrt(variance);
    } else {
      return { score: 0, signal: 'bearish', reason: 'No price data available', metadata: {} };
    }

    metadata.rawVolatility = score;

    let category: VolatilityCategory;
    if (score <= 0.1) category = 'Dead';
    else if (score <= 0.5) category = 'Low';
    else if (score <= 2.0) category = 'Healthy';
    else if (score <= 5.0) category = 'High';
    else category = 'Extreme';

    metadata.category = category;

    if (category === 'Dead') {
      return { score: 0, signal: 'bearish', reason: 'Dead volatility - REJECTED', metadata };
    }
    if (category === 'Extreme') {
      return { score: 0, signal: 'bearish', reason: 'Extreme volatility - REJECTED', metadata };
    }

    let normalizedScore: number;
    switch (category) {
      case 'Healthy': normalizedScore = 80; break;
      case 'High': normalizedScore = 60; break;
      case 'Low': normalizedScore = 30; break;
      default: normalizedScore = 0;
    }

    const finalScore = this.normalizeScore(normalizedScore);
    return {
      score: finalScore,
      signal: this.getSignal(finalScore),
      reason: `volatility=${score.toFixed(4)}, category=${category}`,
      metadata,
    };
  }
}
