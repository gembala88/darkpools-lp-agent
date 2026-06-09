import { BaseEngine } from '../engines/baseEngine.js';

export interface ChiefAIRecommendation {
  action: 'DEPLOY' | 'WATCHLIST' | 'SKIP' | 'SIMULATE';
  confidence: number;
  reasoning: string;
  riskScore: number;
  warnings: string[];
}

export class ChiefAiDecisionSystem extends BaseEngine {
  readonly name = 'ChiefAiDecisionSystem';
  readonly version = '1.0.0';

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const analystResult = params?.analystResult as {
      overallScore?: number;
      confidence?: number;
      weightedScore?: number;
      consensusSignal?: string;
    } | undefined;
    const agentResult = params?.agentResult as {
      score?: number;
      metadata?: Record<string, unknown>;
    } | undefined;
    const marketRegimeScore = Number(params?.marketRegimeScore ?? 50);
    const poolActivityScore = Number(params?.poolActivityScore ?? 50);
    const whaleExitScore = Number(params?.whaleExitScore ?? 100);
    const deploymentMemoryScore = Number(params?.deploymentMemoryScore ?? 50);
    const selfLearningScore = Number(params?.selfLearningScore ?? 50);

    const analystScore = analystResult?.weightedScore ?? analystResult?.overallScore ?? 50;
    const analystConfidence = analystResult?.confidence ?? 50;
    const agentScores = agentResult?.metadata?.opinions as Array<{ agent: string; score: number }> | undefined;
    const agentScore = agentResult?.score ?? 50;

    const baseScore = analystScore * 0.5 + agentScore * 0.3 + marketRegimeScore * 0.1 + poolActivityScore * 0.1;
    const agentConsensusConfidence = (agentResult?.metadata?.consensusConfidence as number) ?? (agentResult?.metadata?.agreementRatio as number ?? 0.5) * 100;
    const combinedConfidence = analystConfidence * 0.6 + agentConsensusConfidence * 0.4;

    const warnings: string[] = [];
    let riskAdjustment = 0;

    if (whaleExitScore < 30) {
      riskAdjustment -= 20;
      warnings.push('CRITICAL: High whale exit probability');
    }

    if (marketRegimeScore < 30) {
      riskAdjustment -= 15;
      warnings.push('Unfavorable market regime');
    }

    if (poolActivityScore < 20) {
      riskAdjustment -= 10;
      warnings.push('Pool activity too low');
    }

    if (deploymentMemoryScore < 35 && deploymentMemoryScore > 0) {
      riskAdjustment -= 10;
      warnings.push('Historical deployment patterns unfavorable');
    }

    if (selfLearningScore < 35 && selfLearningScore > 0) {
      riskAdjustment -= 5;
      warnings.push('Learning engine suggests caution');
    }

    if (agentScores) {
      const conservativeAgents = agentScores.filter(a =>
        ['RiskSentry', 'StabilityAnalyst'].includes(a.agent)
      );
      const avgConservative = conservativeAgents.length > 0
        ? conservativeAgents.reduce((s, a) => s + a.score, 0) / conservativeAgents.length
        : 50;
      if (avgConservative < 40) {
        riskAdjustment -= 10;
        warnings.push('Conservative agents advise against deployment');
      }
    }

    const finalScore = this.normalizeScore(baseScore + riskAdjustment);
    const signal: 'bullish' | 'bearish' | 'neutral' =
      finalScore >= 70 ? 'bullish' : finalScore < 40 ? 'bearish' : 'neutral';

    let action: ChiefAIRecommendation['action'] = 'SKIP';
    if (warnings.length === 0 && finalScore >= 75 && combinedConfidence > 60) {
      action = 'DEPLOY';
    } else if (warnings.length <= 1 && finalScore >= 60 && combinedConfidence >= 40) {
      action = 'SIMULATE';
    } else if (finalScore >= 45) {
      action = 'WATCHLIST';
    }

    return {
      score: finalScore,
      signal,
      reason: `Chief AI: ${action} (score=${finalScore.toFixed(0)}, conf=${combinedConfidence.toFixed(0)})`,
      metadata: {
        recommendation: { action, confidence: Number(combinedConfidence.toFixed(1)), reasoning: warnings.join('; ') || 'All checks passed', riskScore: Number(finalScore.toFixed(1)), warnings },
        analystScore: Number(analystScore.toFixed(2)),
        agentScore: Number(agentScore.toFixed(2)),
        riskAdjustment,
        combinedConfidence: Number(combinedConfidence.toFixed(1)),
        warnings,
        action,
        capitalPreservationMode: finalScore < 35,
      },
    };
  }
}
