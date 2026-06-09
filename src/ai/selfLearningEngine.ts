import { BaseEngine } from '../engines/baseEngine.js';

interface Outcome {
  poolAddress: string;
  score: number;
  actualProfit: number;
  timestamp: number;
}

export class SelfLearningEngine extends BaseEngine {
  readonly name = 'SelfLearningEngine';
  readonly version = '1.0.0';

  private outcomes: Outcome[] = [];

  recordOutcome(poolAddress: string, score: number, actualProfit: number): void {
    this.outcomes.push({ poolAddress, score, actualProfit, timestamp: Date.now() });
    if (this.outcomes.length > 500) {
      this.outcomes = this.outcomes.slice(-500);
    }
  }

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const poolAddress = params?.poolAddress as string;

    if (!poolAddress || this.outcomes.length < 5) {
      return {
        score: 50,
        signal: 'neutral',
        reason: this.outcomes.length < 5 ? 'Insufficient data for learning' : 'No pool address',
        metadata: { sampleCount: this.outcomes.length },
      };
    }

    const recentOutcomes = this.outcomes.slice(-50);
    const avgProfit = recentOutcomes.reduce((s, o) => s + o.actualProfit, 0) / recentOutcomes.length;
    const medianScore = [...recentOutcomes].sort((a, b) => a.score - b.score)[Math.floor(recentOutcomes.length / 2)].score;

    const winRate = recentOutcomes.filter(o => o.actualProfit > 0).length / recentOutcomes.length;

    const scoreCorrelation = this.calculateCorrelation(
      recentOutcomes.map(o => o.score),
      recentOutcomes.map(o => o.actualProfit)
    );

    let confidenceAdjustment = 0;
    const signals: string[] = [];

    if (winRate > 0.6 && avgProfit > 0) {
      confidenceAdjustment = 10;
      signals.push(`high win rate (${(winRate * 100).toFixed(0)}%) with positive avg profit`);
    } else if (winRate > 0.5) {
      confidenceAdjustment = 5;
      signals.push(`moderate win rate (${(winRate * 100).toFixed(0)}%)`);
    } else if (winRate < 0.4) {
      confidenceAdjustment = -10;
      signals.push(`low win rate (${(winRate * 100).toFixed(0)}%) - adjust thresholds`);
    }

    if (scoreCorrelation > 0.3) {
      confidenceAdjustment += 5;
      signals.push('score positively correlated with profit');
    } else if (scoreCorrelation < -0.2) {
      confidenceAdjustment -= 5;
      signals.push('score negatively correlated with profit');
    }

    if (recentOutcomes.length > 30) {
      confidenceAdjustment += 3;
      signals.push('sufficient sample size for learning');
    }

    const baseScore = medianScore;
    const adjustedScore = this.normalizeScore(baseScore + confidenceAdjustment);

    return {
      score: adjustedScore,
      signal: adjustedScore >= 70 ? 'bullish' : adjustedScore < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'Insufficient learning patterns',
      metadata: {
        sampleCount: this.outcomes.length,
        winRate: Number(winRate.toFixed(2)),
        avgProfit: Number(avgProfit.toFixed(4)),
        scoreCorrelation: Number(scoreCorrelation.toFixed(3)),
        confidenceAdjustment,
      },
    };
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 3) return 0;
    const n = x.length;
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }
}
