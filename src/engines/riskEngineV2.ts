import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export class RiskEngineV2 extends BaseEngine {
  readonly name = 'risk_v2';
  readonly version = '2.0.0';

  async evaluate(params?: {
    poolAddress?: string;
    tokenMint?: string;
    tokenAgeHours?: number;
    marketCap?: number;
  }): Promise<EngineResult> {
    const { poolAddress, tokenMint, tokenAgeHours = 0, marketCap = 0 } = params ?? {};
    if (!tokenMint) {
      return { score: 50, signal: 'neutral', reason: 'No token mint, returning neutral risk', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    let riskScore = 100;

    const holders = await repositories.holder.getByToken(tokenMint);
    const top10Concentration = repositories.holder.getConcentration(tokenMint);

    const sortedByBalance = [...holders].sort((a, b) => b.balance - a.balance);
    const top10 = sortedByBalance.slice(0, 10);
    const bundlerScore = this.detectBundlers(top10);

    metadata.top10Concentration = top10Concentration;
    metadata.bundlerScore = bundlerScore;
    metadata.holderCount = holders.length;
    metadata.tokenAgeHours = tokenAgeHours;
    metadata.marketCap = marketCap;

    if (top10Concentration > 80) riskScore -= 30;
    else if (top10Concentration > 60) riskScore -= 15;
    else if (top10Concentration > 40) riskScore -= 5;

    if (bundlerScore > 0.5) riskScore -= 25;
    else if (bundlerScore > 0.3) riskScore -= 10;

    if (holders.length < 100) riskScore -= 15;
    else if (holders.length < 500) riskScore -= 5;

    if (tokenAgeHours < 2) riskScore -= 20;
    else if (tokenAgeHours < 24) riskScore -= 5;

    if (marketCap < 100000) riskScore -= 15;
    else if (marketCap < 500000) riskScore -= 5;

    const rugProbability = this.calculateRugProbability(top10Concentration, bundlerScore, tokenAgeHours, holders.length);
    metadata.rugProbability = rugProbability;

    if (rugProbability > 0.7) riskScore = Math.min(riskScore, 20);
    else if (rugProbability > 0.4) riskScore -= 20;

    const finalScore = this.normalizeScore(riskScore);
    const signal = riskScore >= 60 ? 'bullish' : riskScore >= 30 ? 'neutral' : 'bearish';
    const riskLevel = riskScore >= 70 ? 'Low' : riskScore >= 50 ? 'Medium' : riskScore >= 30 ? 'High' : 'Critical';

    return {
      score: finalScore,
      signal,
      reason: `risk=${riskLevel}, top10=${top10Concentration.toFixed(1)}%, bundler=${(bundlerScore * 100).toFixed(0)}%, rugProb=${(rugProbability * 100).toFixed(0)}%`,
      metadata,
    };
  }

  private detectBundlers(topHolders: Array<{ address: string; firstSeen: Date }>): number {
    if (topHolders.length < 3) return 0;
    const firstSeenTimes = topHolders
      .filter(h => h.firstSeen)
      .map(h => h.firstSeen.getTime());
    if (firstSeenTimes.length < 3) return 0;
    const minTime = Math.min(...firstSeenTimes);
    const maxTime = Math.max(...firstSeenTimes);
    const timeSpread = maxTime - minTime;
    if (timeSpread < 3600_000) {
      return firstSeenTimes.filter(t => t - minTime < 600_000).length / firstSeenTimes.length;
    }
    return 0;
  }

  private calculateRugProbability(
    top10Concentration: number,
    bundlerScore: number,
    tokenAgeHours: number,
    holderCount: number
  ): number {
    let prob = 0;
    if (top10Concentration > 70) prob += 0.3;
    if (bundlerScore > 0.4) prob += 0.3;
    if (tokenAgeHours < 2) prob += 0.2;
    if (holderCount < 200) prob += 0.2;
    return Math.min(prob, 1);
  }
}
