import { BaseEngine } from '../engines/baseEngine.js';
import type { AgentOpinion } from '../types/index.js';

interface AgentConfig {
  name: string;
  bias: 'conservative' | 'aggressive' | 'balanced';
  focus: string[];
}

const AGENTS: AgentConfig[] = [
  { name: 'RiskSentry', bias: 'conservative', focus: ['whaleExit', 'marketPsychology', 'risk'] },
  { name: 'MomentumTracker', bias: 'aggressive', focus: ['marketRegime', 'candleIntelligence', 'accumulation'] },
  { name: 'SmartMoneyFollower', bias: 'balanced', focus: ['smartMoneyFlow', 'accumulation', 'marketRegime'] },
  { name: 'StabilityAnalyst', bias: 'conservative', focus: ['poolActivity', 'marketPsychology', 'whaleExit'] },
  { name: 'OpportunityHunter', bias: 'aggressive', focus: ['accumulation', 'smartMoneyFlow', 'marketRegime'] },
  { name: 'PatternRecognizer', bias: 'balanced', focus: ['candleIntelligence', 'marketRegime', 'marketPsychology'] },
];

export class MultiAgentSystem extends BaseEngine {
  readonly name = 'MultiAgentSystem';
  readonly version = '1.0.0';

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const engineResults = params?.engineResults as Array<{
      engine: string; score: number; signal: string; reason: string;
    }> | undefined;

    if (!engineResults || engineResults.length === 0) {
      return { score: 50, signal: 'neutral', reason: 'No engine results for agents', metadata: {} };
    }

    const opinions: AgentOpinion[] = AGENTS.map(agent => {
      const relevantResults = engineResults.filter(r =>
        agent.focus.some(f => r.engine.toLowerCase().includes(f.toLowerCase()))
      );

      if (relevantResults.length === 0) {
        return {
          agent: agent.name,
          score: 50,
          confidence: 0,
          reasoning: 'No relevant data for this agent',
        };
      }

      const avgScore = relevantResults.reduce((s, r) => s + r.score, 0) / relevantResults.length;

      let adjustedScore = avgScore;
      if (agent.bias === 'conservative') {
        adjustedScore = avgScore * 0.85 + 7.5;
      } else if (agent.bias === 'aggressive') {
        adjustedScore = avgScore * 1.15 - 7.5;
      }

      adjustedScore = Math.max(0, Math.min(100, adjustedScore));

      const confidence = Math.max(0, 100 - this.calculateAgentDoubt(relevantResults));

      const topResult = relevantResults.sort((a, b) => b.score - a.score)[0];
      return {
        agent: agent.name,
        score: Number(adjustedScore.toFixed(1)),
        confidence: Number(confidence.toFixed(1)),
        reasoning: `${agent.bias} view: ${topResult?.reason ?? 'insufficient data'}`,
      };
    });

    const weightedScore = this.calculateConsensus(opinions);
    const highConfidenceOpinions = opinions.filter(o => o.confidence > 50);
    const agreementRatio = opinions.length > 0
      ? highConfidenceOpinions.filter(o => 
          (o.score >= 70 && weightedScore >= 70) ||
          (o.score < 40 && weightedScore < 40) ||
          (o.score >= 40 && o.score < 70 && weightedScore >= 40 && weightedScore < 70)
        ).length / opinions.length
      : 0;

    const consensusConfidence = Number((agreementRatio * 100).toFixed(1));

    const finalSignal: 'bullish' | 'bearish' | 'neutral' = 
      weightedScore >= 70 ? 'bullish' : weightedScore < 40 ? 'bearish' : 'neutral';

    const agentSummaries = opinions.map(o => 
      `${o.agent}:${o.score.toFixed(0)}(${o.confidence.toFixed(0)}%conf)`
    ).join(', ');

    return {
      score: this.normalizeScore(weightedScore),
      signal: finalSignal,
      reason: `Agent consensus: ${finalSignal} (agreement=${agreementRatio.toFixed(2)}): ${agentSummaries}`,
      metadata: {
        opinions: opinions.map(o => ({
          agent: o.agent,
          score: o.score,
          confidence: o.confidence,
          reasoning: o.reasoning,
        })),
        agreementRatio: Number(agreementRatio.toFixed(2)),
        consensusConfidence,
        weightedScore: Number(weightedScore.toFixed(2)),
        agentCount: opinions.length,
      },
    };
  }

  private calculateConsensus(opinions: AgentOpinion[]): number {
    const weightedSum = opinions.reduce((s, o) => s + o.score * (o.confidence / 100 + 0.5), 0);
    const totalWeight = opinions.reduce((s, o) => s + (o.confidence / 100 + 0.5), 0);
    return totalWeight > 0 ? weightedSum / totalWeight : 50;
  }

  private calculateAgentDoubt(results: Array<{ score: number; signal: string }>): number {
    if (results.length < 2) return 0;
    const scores = results.map(r => r.score);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    return Math.min(100, Math.sqrt(variance) * 2);
  }
}
