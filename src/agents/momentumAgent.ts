export interface MomentumAgentInput {
  txMomentumScore: number;
  volumeAcceleration: number;
  hotPoolScore: number;
  candleTrend: string;
}

export interface MomentumAgentOutput {
  score: number;
  signal: 'WEAK' | 'BUILDING' | 'STRONG' | 'EXPLOSIVE';
  reasoning: string;
}

export class MomentumAgent {
  readonly name = 'momentumAgent';

  evaluate(input: MomentumAgentInput): MomentumAgentOutput {
    const { txMomentumScore, volumeAcceleration, hotPoolScore, candleTrend } = input;
    const reasons: string[] = [];
    let score = 50;

    score += (txMomentumScore - 50) * 0.4;
    if (txMomentumScore > 70) reasons.push('tx momentum strong');
    else if (txMomentumScore < 30) reasons.push('tx momentum weak');

    if (volumeAcceleration > 20) { score += 15; reasons.push('volume accelerating'); }
    else if (volumeAcceleration > 10) score += 8;
    else if (volumeAcceleration < -10) { score -= 10; reasons.push('volume decelerating'); }

    score += hotPoolScore * 0.2;
    if (hotPoolScore > 70) reasons.push('hot pool');

    if (candleTrend === 'STRONG_BULLISH') { score += 15; reasons.push('strong bullish candle'); }
    else if (candleTrend === 'BULLISH') { score += 8; reasons.push('bullish candle'); }
    else if (candleTrend === 'BEARISH') { score -= 10; reasons.push('bearish candle'); }
    else if (candleTrend === 'STRONG_BEARISH') { score -= 15; reasons.push('strong bearish candle'); }

    const finalScore = Math.max(0, Math.min(100, score));
    const signal: MomentumAgentOutput['signal'] = finalScore >= 75 ? 'EXPLOSIVE' : finalScore >= 55 ? 'STRONG' : finalScore >= 35 ? 'BUILDING' : 'WEAK';
    const reasoning = reasons.length > 0 ? reasons.join('; ') : 'neutral momentum';

    return { score: finalScore, signal, reasoning };
  }
}
