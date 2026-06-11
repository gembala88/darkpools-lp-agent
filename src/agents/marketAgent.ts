export interface MarketAgentInput {
  marketRegime: string;
  marketPsychology: string;
  candleTrend: string;
  trendState: string;
}

export interface MarketAgentOutput {
  score: number;
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  reasoning: string;
}

export class MarketAgent {
  readonly name = 'marketAgent';

  evaluate(input: MarketAgentInput): MarketAgentOutput {
    const { marketRegime, marketPsychology, candleTrend, trendState } = input;
    const reasons: string[] = [];
    let score = 50;

    if (marketRegime === 'ACCUMULATION') { score += 20; reasons.push('accumulation regime'); }
    else if (marketRegime === 'TRENDING_BULLISH') { score += 15; reasons.push('bullish trend'); }
    else if (marketRegime === 'DISTRIBUTION') { score -= 15; reasons.push('distribution regime'); }
    else if (marketRegime === 'PANIC') { score -= 25; reasons.push('panic regime'); }
    else if (marketRegime === 'EUPHORIA') { score -= 10; reasons.push('euphoria - topping risk'); }

    if (marketPsychology === 'FEAR') { score -= 10; reasons.push('fear sentiment'); }
    else if (marketPsychology === 'GREED') { score -= 5; reasons.push('greed sentiment'); }
    else if (marketPsychology === 'EUPHORIA') { score -= 15; reasons.push('euphoria sentiment'); }
    else if (marketPsychology === 'CAPITULATION') { score -= 20; reasons.push('capitulation'); }

    if (candleTrend === 'STRONG_BULLISH' || trendState === 'STRONG_BULLISH') { score += 15; reasons.push('strong bullish structure'); }
    else if (candleTrend === 'STRONG_BEARISH' || trendState === 'STRONG_BEARISH') { score -= 15; reasons.push('strong bearish structure'); }

    const finalScore = Math.max(0, Math.min(100, score));
    const signal: MarketAgentOutput['signal'] = finalScore >= 60 ? 'BULLISH' : finalScore >= 40 ? 'NEUTRAL' : 'BEARISH';
    const reasoning = reasons.length > 0 ? reasons.join('; ') : 'neutral market conditions';

    return { score: finalScore, signal, reasoning };
  }
}
