export interface WhaleAgentInput {
  whaleExitProbability: number;
  smartMoneyScore: number;
  top10Pct: number;
  concentrationRisk: number;
}

export interface WhaleAgentOutput {
  score: number;
  signal: 'ACCUMULATING' | 'NEUTRAL' | 'DISTRIBUTING' | 'EXITING';
  reasoning: string;
}

export class WhaleAgent {
  readonly name = 'whaleAgent';

  evaluate(input: WhaleAgentInput): WhaleAgentOutput {
    const { whaleExitProbability, smartMoneyScore, top10Pct, concentrationRisk } = input;
    const reasons: string[] = [];
    let score = 50;

    if (whaleExitProbability > 75) { score -= 30; reasons.push(`whale exit ${whaleExitProbability}% > 75`); }
    else if (whaleExitProbability > 50) { score -= 15; reasons.push(`whale exit ${whaleExitProbability}% elevated`); }
    else if (whaleExitProbability < 20) { score += 15; reasons.push(`whale exit low ${whaleExitProbability}%`); }
    else if (whaleExitProbability < 40) score += 5;

    score += (smartMoneyScore - 50) * 0.3;
    if (smartMoneyScore > 70) reasons.push('smart money accumulating');
    else if (smartMoneyScore < 30) reasons.push('smart money exiting');

    if (concentrationRisk > 60) { score -= 15; reasons.push(`concentration ${concentrationRisk}%`); }
    else if (top10Pct > 60) { score -= 10; reasons.push(`top10 ${top10Pct}% high`); }

    const finalScore = Math.max(0, Math.min(100, score));
    const signal: WhaleAgentOutput['signal'] = finalScore >= 70 ? 'ACCUMULATING' : finalScore >= 45 ? 'NEUTRAL' : finalScore >= 25 ? 'DISTRIBUTING' : 'EXITING';
    const reasoning = reasons.length > 0 ? reasons.join('; ') : 'neutral whale activity';

    return { score: finalScore, signal, reasoning };
  }
}
