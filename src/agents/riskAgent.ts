export interface RiskAgentInput {
  rugProbability: number;
  concentrationRisk: number;
  bundlerRisk: string;
  liquidityAgeRisk: string;
  riskScore: number;
}

export interface RiskAgentOutput {
  score: number;
  signal: 'SAFE' | 'CAUTION' | 'DANGER' | 'CRITICAL';
  reasoning: string;
}

export class RiskAgent {
  readonly name = 'riskAgent';

  evaluate(input: RiskAgentInput): RiskAgentOutput {
    const { rugProbability, concentrationRisk, bundlerRisk, liquidityAgeRisk, riskScore } = input;
    const reasons: string[] = [];

    let rawScore = riskScore;

    if (rugProbability > 60) { rawScore = 0; reasons.push(`rug ${rugProbability}% > 60`); }
    else if (rugProbability > 40) { rawScore -= 30; reasons.push(`rug ${rugProbability}% elevated`); }
    else if (rugProbability > 20) { rawScore -= 15; reasons.push(`rug ${rugProbability}% moderate`); }

    if (bundlerRisk === 'CRITICAL') { rawScore = 0; reasons.push('bundler CRITICAL'); }
    else if (bundlerRisk === 'HIGH') { rawScore -= 25; reasons.push('bundler HIGH'); }
    else if (bundlerRisk === 'MEDIUM') { rawScore -= 10; reasons.push('bundler MEDIUM'); }

    if (concentrationRisk > 80) { rawScore = 0; reasons.push(`concentration ${concentrationRisk}% > 80`); }
    else if (concentrationRisk > 50) { rawScore -= 20; reasons.push(`concentration ${concentrationRisk}% high`); }
    else if (concentrationRisk > 30) { rawScore -= 10; reasons.push(`concentration ${concentrationRisk}% moderate`); }

    if (liquidityAgeRisk === 'SUSPICIOUS') { rawScore -= 20; reasons.push('liq age < 1h'); }
    else if (liquidityAgeRisk === 'CAUTION') { rawScore -= 5; reasons.push('liq age < 24h'); }

    const score = Math.max(0, Math.min(100, rawScore));
    const signal: RiskAgentOutput['signal'] = score >= 70 ? 'SAFE' : score >= 50 ? 'CAUTION' : score >= 25 ? 'DANGER' : 'CRITICAL';
    const reasoning = reasons.length > 0 ? reasons.join('; ') : 'no risk signals';

    return { score, signal, reasoning };
  }
}
