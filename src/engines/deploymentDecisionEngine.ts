import { BaseEngine, EngineResult } from './baseEngine.js';

export type DeploymentDecision = 'REJECT' | 'WATCHLIST' | 'SIMULATE' | 'DEPLOY_SMALL' | 'DEPLOY_NORMAL' | 'DEPLOY_AGGRESSIVE';

interface Thresholds {
  rejectScore: number;
  watchlistScore: number;
  simulateScore: number;
  deploySmallScore: number;
  deployNormalScore: number;
  deployAggressiveScore: number;
  minConfidence: number;
}

export class DeploymentDecisionEngine extends BaseEngine {
  readonly name = 'deployment_decision';
  readonly version = '1.0.0';

  private thresholds: Thresholds = {
    rejectScore: 70,
    watchlistScore: 75,
    simulateScore: 80,
    deploySmallScore: 85,
    deployNormalScore: 90,
    deployAggressiveScore: 95,
    minConfidence: 75,
  };

  async evaluate(params?: {
    lpAlphaScore?: number;
    confidence?: number;
    componentScores?: Record<string, number>;
  }): Promise<EngineResult> {
    const { lpAlphaScore = 0, confidence = 0, componentScores = {} } = params ?? {};
    const metadata: Record<string, unknown> = {
      lpAlphaScore,
      confidence,
      componentScores,
    };

    const decision = this.makeDecision(lpAlphaScore, confidence, componentScores);
    metadata.decision = decision;

    return {
      score: lpAlphaScore,
      signal: decision === 'REJECT' ? 'bearish' : 'bullish',
      reason: `Decision: ${decision} (score: ${lpAlphaScore.toFixed(2)}, confidence: ${confidence.toFixed(1)}%)`,
      metadata,
    };
  }

  private makeDecision(score: number, confidence: number, components: Record<string, number>): DeploymentDecision {
    const t = this.thresholds;

    if (score < t.rejectScore || confidence < t.minConfidence) {
      return 'REJECT';
    }

    const hasNegativeSignal = Object.values(components).some(v => v < 30);
    if (hasNegativeSignal) {
      return 'WATCHLIST';
    }

    if (score >= t.deployAggressiveScore && confidence >= 90) return 'DEPLOY_AGGRESSIVE';
    if (score >= t.deployNormalScore && confidence >= 80) return 'DEPLOY_NORMAL';
    if (score >= t.deploySmallScore && confidence >= t.minConfidence) return 'DEPLOY_SMALL';
    if (score >= t.simulateScore) return 'SIMULATE';
    if (score >= t.watchlistScore) return 'WATCHLIST';

    return 'REJECT';
  }

  setThresholds(thresholds: Partial<Thresholds>): void {
    Object.assign(this.thresholds, thresholds);
  }
}
