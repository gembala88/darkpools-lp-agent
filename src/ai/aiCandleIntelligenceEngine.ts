import { BaseEngine } from '../engines/baseEngine.js';
import { repositories } from '../repositories/index.js';

export class AICandleIntelligenceEngine extends BaseEngine {
  readonly name = 'AICandleIntelligenceEngine';
  readonly version = '1.0.0';

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const poolAddress = params?.poolAddress as string;
    const tokenMint = params?.tokenMint as string;
    const priceChanges = params?.priceChanges as number[] | undefined;

    if (!poolAddress) {
      return { score: 50, signal: 'neutral', reason: 'No pool address', metadata: {} };
    }

    const marketData = await repositories.market.getLatest(poolAddress);

    const price = marketData?.price ?? 0;
    const volume5m = marketData?.volume5m ?? 0;
    const volume15m = marketData?.volume15m ?? 0;
    const volume30m = marketData?.volume30m ?? 0;
    const volume1h = marketData?.volume1h ?? 0;
    const buyVolume5m = marketData?.buyVolume5m ?? 0;
    const sellVolume5m = marketData?.sellVolume5m ?? 0;
    const txCount5m = marketData?.txCount5m ?? 0;

    const volumeTrend = this.calculateTrend(volume5m, volume15m);

    const volRatio = (buyVolume5m + sellVolume5m) > 0 ? buyVolume5m / (buyVolume5m + sellVolume5m) : 0.5;

    const txPerVolume = volume5m > 0 ? txCount5m / volume5m : 0;

    let score = 50;
    const signals: string[] = [];
    let pattern = 'NEUTRAL';

    if (priceChanges && priceChanges.length >= 5) {
      const recent = priceChanges.slice(-5);
      const avg = recent.reduce((s, p) => s + p, 0) / recent.length;
      const maxDrawdown = Math.min(...recent);
      const maxRunup = Math.max(...recent);

      if (avg > 2 && volumeTrend === 'up' && volRatio > 0.6) {
        pattern = 'STRONG_UPTREND';
        score = 85;
        signals.push('strong uptrend with volume confirmation');
      } else if (avg > 0.5 && volRatio > 0.55) {
        pattern = 'UPTREND';
        score = 70;
        signals.push('moderate uptrend');
      } else if (avg < -2 && volumeTrend === 'up' && volRatio < 0.4) {
        pattern = 'STRONG_DOWNTREND';
        score = 20;
        signals.push('strong downtrend with volume');
      } else if (avg < -0.5 && volRatio < 0.45) {
        pattern = 'DOWNTREND';
        score = 30;
        signals.push('moderate downtrend');
      } else if (maxDrawdown > -3 && maxRunup < 3 && avg > -0.5 && avg < 0.5) {
        pattern = 'CONSOLIDATION';
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
        pattern,
        price,
        volRatio: Number(volRatio.toFixed(2)),
        volumeTrend,
        txPerVolume: Number(txPerVolume.toFixed(6)),
        priceChangeCount: priceChanges?.length ?? 0,
      },
    };
  }
}
