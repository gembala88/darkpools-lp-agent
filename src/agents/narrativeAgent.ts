export interface NarrativeAgentInput {
  narrativeScore: number;
  capitalRotationScore: number;
  hotNarrative: string;
}

export interface NarrativeAgentOutput {
  score: number;
  signal: 'HOT' | 'WARM' | 'COLD';
  reasoning: string;
}

export class NarrativeAgent {
  readonly name = 'narrativeAgent';

  evaluate(input: NarrativeAgentInput): NarrativeAgentOutput {
    const { narrativeScore, capitalRotationScore, hotNarrative } = input;
    const reasons: string[] = [];
    let score = 50;

    score += (narrativeScore - 50) * 0.4;
    if (narrativeScore > 70) reasons.push('strong narrative');
    else if (narrativeScore < 30) reasons.push('weak narrative');

    score += (capitalRotationScore - 50) * 0.25;
    if (capitalRotationScore > 70) reasons.push('capital rotating in');
    else if (capitalRotationScore < 30) reasons.push('capital rotating out');

    if (hotNarrative === 'HOT' || hotNarrative === 'hot') { score += 20; reasons.push('hot narrative trend'); }
    else if (hotNarrative === 'WARM' || hotNarrative === 'warm') { score += 10; reasons.push('warming narrative'); }

    const finalScore = Math.max(0, Math.min(100, score));
    const signal: NarrativeAgentOutput['signal'] = finalScore >= 65 ? 'HOT' : finalScore >= 40 ? 'WARM' : 'COLD';
    const reasoning = reasons.length > 0 ? reasons.join('; ') : 'neutral narrative';

    return { score: finalScore, signal, reasoning };
  }
}
