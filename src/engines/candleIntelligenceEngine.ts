import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export type CandlePattern = 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';

export class CandleIntelligenceEngine extends BaseEngine {
  readonly name = 'candle_intelligence';
  readonly version = '2.0.0';

  async evaluate(params?: {
    poolAddress?: string;
    tokenMint?: string;
    priceChanges?: number[];
  }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress ?? '';
    const tokenMint = params?.tokenMint;
    const priceChanges = params?.priceChanges;

    if (!poolAddress) {
      return { score: 50, signal: 'neutral', reason: 'No pool address', metadata: {} };
    }

    const marketData = await repositories.market.getLatest(poolAddress);
    const price = marketData?.price ?? 0;
    const volume5m = marketData?.volume5m ?? 0;
    const volume15m = marketData?.volume15m ?? 0;
    const buyVolume5m = marketData?.buyVolume5m ?? 0;
    const sellVolume5m = marketData?.sellVolume5m ?? 0;
    const txCount5m = marketData?.txCount5m ?? 0;

    const volumeTrend = this.calculateTrend(volume5m, volume15m);
    const volRatio = (buyVolume5m + sellVolume5m) > 0 ? buyVolume5m / (buyVolume5m + sellVolume5m) : 0.5;
    const txPerVolume = volume5m > 0 ? txCount5m / volume5m : 0;

    let score = 50;
    const signals: string[] = [];
    let trendState: CandlePattern = 'NEUTRAL';

    if (priceChanges && priceChanges.length >= 5) {
      const recent = priceChanges.slice(-5);
      const avg = recent.reduce((s, p) => s + p, 0) / recent.length;
      const maxDrawdown = Math.min(...recent);
      const maxRunup = Math.max(...recent);

      if (avg > 2 && volumeTrend === 'up' && volRatio > 0.6) {
        trendState = 'STRONG_BULLISH';
        score = 85;
        signals.push('strong uptrend with volume confirmation');
      } else if (avg > 0.5 && volRatio > 0.55) {
        trendState = 'BULLISH';
        score = 70;
        signals.push('moderate uptrend');
      } else if (avg < -2 && volumeTrend === 'up' && volRatio < 0.4) {
        trendState = 'STRONG_BEARISH';
        score = 20;
        signals.push('strong downtrend with volume');
      } else if (avg < -0.5 && volRatio < 0.45) {
        trendState = 'BEARISH';
        score = 30;
        signals.push('moderate downtrend');
      } else if (maxDrawdown > -3 && maxRunup < 3 && avg > -0.5 && avg < 0.5) {
        trendState = 'NEUTRAL';
        score = 45;
        signals.push('price consolidation');
      }

      if (maxRunup > 10 && maxDrawdown > -3) {
        score = Math.min(95, score + 10);
        signals.push('high momentum with limited downside');
      }

      if (maxDrawdown < -15) {
        score = Math.max(5, score - 20);
        signals.push('severe drawdown detected');
      }
    }

    return {
      score: this.normalizeScore(score),
      signal: score >= 70 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'No clear candle pattern detected',
      metadata: {
        trendState,
        price,
        volRatio: Number(volRatio.toFixed(2)),
        volumeTrend,
        txPerVolume: Number(txPerVolume.toFixed(6)),
        priceChangeCount: priceChanges?.length ?? 0,
        volume5m,
        volume15m,
      },
    };
  }
}
