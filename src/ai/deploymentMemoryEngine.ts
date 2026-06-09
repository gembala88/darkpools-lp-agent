import { BaseEngine } from '../engines/baseEngine.js';
import type { DeployRecord, PatternRecord, MarketRegime } from '../types/index.js';

export class DeploymentMemoryEngine extends BaseEngine {
  readonly name = 'DeploymentMemoryEngine';
  readonly version = '1.0.0';

  private deployHistory: DeployRecord[] = [];
  private patterns: PatternRecord[] = [];

  recordDeployment(record: DeployRecord): void {
    this.deployHistory.push(record);
    if (this.deployHistory.length > 1000) {
      this.deployHistory = this.deployHistory.slice(-1000);
    }
    this.updatePatterns();
  }

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const currentScore = Number(params?.currentScore ?? 50);
    const marketRegime = (params?.marketRegime as MarketRegime) ?? 'RANGING';

    if (this.deployHistory.length < 3) {
      return {
        score: currentScore,
        signal: 'neutral',
        reason: 'Insufficient deployment history',
        metadata: { totalDeployments: this.deployHistory.length },
      };
    }

    const relevantPattern = this.patterns.find(p =>
      p.conditions.marketRegime === marketRegime &&
      currentScore >= p.conditions.lpAlphaScoreRange[0] &&
      currentScore <= p.conditions.lpAlphaScoreRange[1]
    );

    if (!relevantPattern) {
      return {
        score: currentScore,
        signal: 'neutral',
        reason: 'No matching historical pattern found',
        metadata: { totalDeployments: this.deployHistory.length },
      };
    }

    const { successRate, avgProfit } = relevantPattern.outcomes;
    let adjustment = 0;
    const signals: string[] = [];

    if (successRate > 0.7 && avgProfit > 0) {
      adjustment = 10;
      signals.push(`historical success rate ${(successRate * 100).toFixed(0)}% in ${marketRegime}`);
    } else if (successRate > 0.5) {
      adjustment = 5;
      signals.push(`moderate historical success in ${marketRegime}`);
    } else if (successRate < 0.3) {
      adjustment = -15;
      signals.push(`poor historical performance in ${marketRegime} regime`);
    }

    const recentDeploys = this.deployHistory.filter(d => {
      const ts = typeof d.timestamp === 'string' ? new Date(d.timestamp).getTime() : (d.timestamp as unknown as number);
      return (Date.now() - ts) < 86400000;
    });

    if (recentDeploys.length > 5) {
      const recentWins = recentDeploys.filter(d => d.profit > 0).length;
      const recentWinRate = recentWins / recentDeploys.length;
      if (recentWinRate < 0.3) {
        adjustment -= 10;
        signals.push('cooldown: recent poor performance');
      }
    }

    const adjustedScore = this.normalizeScore(currentScore + adjustment);

    return {
      score: adjustedScore,
      signal: adjustedScore >= 70 ? 'bullish' : adjustedScore < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'No significant historical pattern',
      metadata: {
        totalDeployments: this.deployHistory.length,
        matchedPatterns: relevantPattern ? 1 : 0,
        successRate: Number(successRate.toFixed(2)),
        avgProfit: Number(avgProfit.toFixed(4)),
        recentDeployments24h: recentDeploys.length,
        adjustment,
      },
    };
  }

  private updatePatterns(): void {
    if (this.deployHistory.length < 5) return;
    this.patterns = [];

    const regimes = [...new Set(this.deployHistory.map(d => d.marketRegime))];

    for (const regime of regimes) {
      const regimeDeploys = this.deployHistory.filter(d => d.marketRegime === regime);
      if (regimeDeploys.length < 3) continue;

      const scoreRanges = [
        [0, 30], [30, 50], [50, 70], [70, 85], [85, 100],
      ] as [number, number][];

      for (const [min, max] of scoreRanges) {
        const matched = regimeDeploys.filter(d => d.lpAlphaScore >= min && d.lpAlphaScore <= max);
        if (matched.length < 2) continue;

        const profits = matched.map(d => d.profit);
        const avgProfit = profits.reduce((s, p) => s + p, 0) / profits.length;
        const avgApr = matched.reduce((s, d) => s + d.apr, 0) / matched.length;
        const successRate = matched.filter(d => d.profit > 0).length / matched.length;
        const sampleCount = matched.length;

        this.patterns.push({
          conditions: { marketRegime: regime, lpAlphaScoreRange: [min, max], momentumScoreRange: [0, 100] },
          outcomes: { avgProfit, avgApr, successRate, sampleCount },
        });
      }
    }
  }
}
