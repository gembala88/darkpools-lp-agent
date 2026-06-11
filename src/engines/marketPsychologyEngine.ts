import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export type PsychologyState = 'FEAR' | 'NEUTRAL' | 'GREED' | 'EUPHORIA' | 'CAPITULATION';

export class MarketPsychologyEngine extends BaseEngine {
  readonly name = 'market_psychology';
  readonly version = '2.0.0';

  async evaluate(params?: {
    poolAddress?: string;
    tokenMint?: string;
    priceChanges?: number[];
  }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress ?? '';
    const priceChanges = params?.priceChanges;

    if (!poolAddress) {
      return { score: 50, signal: 'neutral', reason: 'No pool address', metadata: { psychology: 'NEUTRAL' } };
    }

    const marketData = await repositories.market.getLatest(poolAddress);
    const volume5m = marketData?.volume5m ?? 0;
    const volume1h = marketData?.volume1h ?? 0;
    const buyVolume5m = marketData?.buyVolume5m ?? 0;
    const sellVolume5m = marketData?.sellVolume5m ?? 0;

    const totalVol5m = buyVolume5m + sellVolume5m;
    const buyRatio = totalVol5m > 0 ? buyVolume5m / totalVol5m : 0.5;
    const volumeMomentum = volume1h > 0 ? volume5m / (volume1h / 12) : 1;

    let score = 50;
    let psychology: PsychologyState = 'NEUTRAL';
    const signals: string[] = [];

    // Psychological analysis based on price action + volume behavior
    if (priceChanges && priceChanges.length >= 10) {
      const recent = priceChanges.slice(-10);
      const avg = recent.reduce((s, p) => s + p, 0) / recent.length;
      const volatility = Math.sqrt(recent.reduce((s, p) => s + (p - avg) ** 2, 0) / recent.length);
      const maxRunup = Math.max(...recent);
      const maxDrawdown = Math.min(...recent);

      // Extreme conditions
      if (avg > 8 && volatility > 5 && buyRatio > 0.7 && volumeMomentum > 2) {
        psychology = 'EUPHORIA';
        score = 85;
        signals.push('euphoric buying with high volume');
      } else if (avg < -8 && volatility > 5 && buyRatio < 0.3 && volumeMomentum > 2) {
        psychology = 'CAPITULATION';
        score = 15;
        signals.push('capitulation selling with high volume');
      } else if (avg > 3 && buyRatio > 0.6) {
        psychology = 'GREED';
        score = 70;
        signals.push('greed-driven buying pressure');
      } else if (avg < -3 && buyRatio < 0.4) {
        psychology = 'FEAR';
        score = 30;
        signals.push('fear-driven selling pressure');
      }

      if (psychology === 'EUPHORIA' && maxDrawdown < -5) {
        signals.push('WARNING: euphoria with recent drawdown — distribution risk');
      }

      if (psychology === 'FEAR' && buyRatio > 0.45 && avg > -1) {
        signals.push('fear subsiding — potential accumulation opportunity');
      }
    }

    return {
      score: this.normalizeScore(score),
      signal: score >= 70 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'No clear psychological signal',
      metadata: {
        psychology,
        buyRatio: Number(buyRatio.toFixed(2)),
        volumeMomentum: Number(volumeMomentum.toFixed(2)),
        priceChangeCount: priceChanges?.length ?? 0,
      },
    };
  }
}
