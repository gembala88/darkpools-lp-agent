export interface SmartMoneyAgentInput {
  smartMoneyScore: number;
  smartMoneyFlowScore: number;
  capitalInflowScore: number;
  holderGrowthScore: number;
}

export interface SmartMoneyAgentOutput {
  score: number;
  signal: 'ACCUMULATING' | 'NEUTRAL' | 'DISTRIBUTING';
  reasoning: string;
}

export class SmartMoneyAgent {
  readonly name = 'smartMoneyAgent';

  evaluate(input: SmartMoneyAgentInput): SmartMoneyAgentOutput {
    const { smartMoneyScore, smartMoneyFlowScore, capitalInflowScore, holderGrowthScore } = input;
    const reasons: string[] = [];
    let score = 50;

    score += (smartMoneyScore - 50) * 0.3;
    if (smartMoneyScore > 70) reasons.push('smart money conviction high');
    else if (smartMoneyScore < 30) reasons.push('smart money conviction low');

    score += (smartMoneyFlowScore - 50) * 0.25;
    if (smartMoneyFlowScore > 60) reasons.push('smart money flowing in');
    else if (smartMoneyFlowScore < 40) reasons.push('smart money flowing out');

    score += (capitalInflowScore - 50) * 0.2;
    if (capitalInflowScore > 70) reasons.push('capital inflows strong');
    else if (capitalInflowScore < 30) reasons.push('capital outflows');

    score += (holderGrowthScore - 50) * 0.15;
    if (holderGrowthScore > 70) reasons.push('holder base growing');
    else if (holderGrowthScore < 30) reasons.push('holder base shrinking');

    const finalScore = Math.max(0, Math.min(100, score));
    const signal: SmartMoneyAgentOutput['signal'] = finalScore >= 60 ? 'ACCUMULATING' : finalScore >= 40 ? 'NEUTRAL' : 'DISTRIBUTING';
    const reasoning = reasons.length > 0 ? reasons.join('; ') : 'neutral smart money activity';

    return { score: finalScore, signal, reasoning };
  }
}
