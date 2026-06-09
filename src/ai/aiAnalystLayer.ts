import { BaseEngine } from '../engines/baseEngine.js';
import type { AIWeights } from './dynamicWeightEngine.js';

export interface AIAnalystResult {
  overallScore: number;
  confidence: number;
  signals: Array<{ engine: string; score: number; signal: string; reason: string }>;
  weightedScore: number;
  consensusSignal: 'bullish' | 'bearish' | 'neutral';
  reasoning: string;
}

export class AIAnalystLayer extends BaseEngine {
  readonly name = 'AIAnalystLayer';
  readonly version = '1.0.0';

  private readonly capitalPreservationGate = 0.35;

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const engineResults = params?.engineResults as Array<{
      engine: string; score: number; signal: string; reason: string; metadata?: Record<string, unknown>;
    }> | undefined;
    const weights = params?.weights as AIWeights | undefined;

    if (!engineResults || engineResults.length === 0) {
      return { score: 50, signal: 'neutral', reason: 'No engine results to analyze', metadata: {} };
    }

    const signals = engineResults.map(r => ({
      engine: r.engine,
      score: r.score,
      signal: r.signal,
      reason: r.reason,
    }));

    let weightedScore = 0;
    if (weights) {
      let totalWeight = 0;
      for (const signal of signals) {
        const weightKey = this.engineToWeightKey(signal.engine);
        const weight = (weights as unknown as Record<string, number>)[weightKey] ?? 0.10;
        weightedScore += signal.score * weight;
        totalWeight += weight;
      }
      if (totalWeight > 0) weightedScore /= totalWeight;
    } else {
      weightedScore = signals.reduce((s, r) => s + r.score, 0) / signals.length;
    }

    const criticalEngines = ['whaleExit'];
    const criticalScores = signals.filter(s => criticalEngines.includes(s.engine));
    const hasCriticalRejection = criticalScores.some(s => s.score < 30);

    if (hasCriticalRejection) {
      weightedScore = Math.min(weightedScore, 35);
    }

    const bullishSignals = signals.filter(s => s.signal === 'bullish').length;
    const bearishSignals = signals.filter(s => s.signal === 'bearish').length;
    const totalSignals = signals.length;

    let consensusSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (bullishSignals > bearishSignals && bullishSignals >= Math.ceil(totalSignals * 0.5)) {
      consensusSignal = 'bullish';
    } else if (bearishSignals > bullishSignals && bearishSignals >= Math.ceil(totalSignals * 0.5)) {
      consensusSignal = 'bearish';
    }

    const scores = signals.map(s => s.score);
    const stdDev = Math.sqrt(this.calculateVariance(scores));
    const confidence = Math.max(5, Math.min(100, 100 - stdDev * 3));

    const reasoning = this.buildReasoning(signals, consensusSignal, weightedScore);

    return {
      score: this.normalizeScore(weightedScore),
      signal: consensusSignal,
      reason: reasoning,
      metadata: {
        overallScore: Number(weightedScore.toFixed(2)),
        confidence: Number(confidence.toFixed(1)),
        signals: signals.map(s => ({ engine: s.engine, score: s.score, signal: s.signal })),
        weightedScore: Number(weightedScore.toFixed(2)),
        consensusSignal,
        bullishCount: bullishSignals,
        bearishCount: bearishSignals,
        neutralCount: totalSignals - bullishSignals - bearishSignals,
        capitalPreservationMode: weightedScore < this.capitalPreservationGate * 100,
      },
    };
  }

  private engineToWeightKey(engine: string): string {
    const map: Record<string, string> = {
      marketRegime: 'marketRegime',
      poolActivity: 'poolActivity',
      accumulation: 'accumulation',
      whaleExit: 'whaleExit',
      smartMoneyFlow: 'smartMoneyFlow',
      candleIntelligence: 'candleIntelligence',
      marketPsychology: 'marketPsychology',
      selfLearning: 'selfLearning',
      deploymentMemory: 'deploymentMemory',
    };
    return map[engine] ?? engine;
  }

  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  }

  private buildReasoning(
    signals: Array<{ engine: string; score: number; signal: string }>,
    consensus: string,
    weightedScore: number
  ): string {
    const bullish = signals.filter(s => s.signal === 'bullish');
    const bearish = signals.filter(s => s.signal === 'bearish');
    const parts: string[] = [];

    if (bullish.length > 0) {
      parts.push(`bullish: ${bullish.map(s => `${s.engine}=${s.score.toFixed(0)}`).join(', ')}`);
    }
    if (bearish.length > 0) {
      parts.push(`bearish: ${bearish.map(s => `${s.engine}=${s.score.toFixed(0)}`).join(', ')}`);
    }

    parts.push(`consensus=${consensus}, weighted=${weightedScore.toFixed(1)}`);
    return parts.join('; ');
  }
}
