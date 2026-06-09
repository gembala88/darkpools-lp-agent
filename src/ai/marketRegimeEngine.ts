import { BaseEngine } from '../engines/baseEngine.js';
import { repositories } from '../repositories/index.js';
import type { MarketRegime } from '../types/index.js';

export class MarketRegimeEngine extends BaseEngine {
  readonly name = 'MarketRegimeEngine';
  readonly version = '1.0.0';

  async evaluate(params?: Record<string, unknown>): Promise<{
    score: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    reason: string;
    metadata: Record<string, unknown>;
  }> {
    const poolAddress = params?.poolAddress as string;
    const tokenMint = params?.tokenMint as string;

    if (!poolAddress) {
      return { score: 50, signal: 'neutral', reason: 'No pool address provided', metadata: { regime: 'RANGING' } };
    }

    const [marketData, liquidityData] = await Promise.all([
      repositories.market.getLatest(poolAddress),
      repositories.liquidity.getLatest(poolAddress),
    ]);

    const price = marketData?.price ?? 0;
    const volume24h = marketData?.volume24h ?? 0;
    const txCount5m = marketData?.txCount5m ?? 0;
    const txCount1h = marketData?.txCount1h ?? 0;
    const tvl = liquidityData?.tvl ?? 0;

    const { buys: recentBuys, sells: recentSells } = repositories.transaction.getBuySellCount(poolAddress, 5);
    const recentTotal = recentBuys + recentSells;

    const volumeSpike = volume24h > 0 && tvl > 0 ? volume24h / tvl : 0;
    const txVelocity = txCount5m > 0 ? txCount5m / 5 : 0;
    const buyPressure = recentTotal > 0 ? recentBuys / recentTotal : 0.5;

    let regime: MarketRegime = 'RANGING';
    let score = 50;
    const signals: string[] = [];

    if (volumeSpike > 6 && buyPressure > 0.7 && price > 0) {
      regime = 'EUPHORIA';
      score = 90;
      signals.push('extreme buy pressure with high volume');
    } else if (volumeSpike > 6 && buyPressure < 0.3 && price > 0) {
      regime = 'PANIC';
      score = 10;
      signals.push('high sell volume with panic selling');
    } else if (buyPressure > 0.6 && txVelocity > 5 && price > 0) {
      regime = 'ACCUMULATION';
      score = 75;
      signals.push('consistent buying pressure with high tx velocity');
    } else if (buyPressure < 0.45 && buyPressure > 0.25 && volumeSpike > 3) {
      regime = 'DISTRIBUTION';
      score = 25;
      signals.push('distribution pattern with sell pressure');
    } else if (buyPressure > 0.55 && volumeSpike > 3) {
      regime = 'TRENDING_BULLISH';
      score = 70;
      signals.push('moderate buy bias with healthy volume');
    } else if (buyPressure < 0.4 && volumeSpike > 3) {
      regime = 'TRENDING_BEARISH';
      score = 30;
      signals.push('sell bias with significant volume');
    } else if (txVelocity > 2 && volumeSpike > 1) {
      regime = 'RANGING';
      score = 50;
      signals.push('active market with no clear directional bias');
    } else {
      regime = 'RANGING';
      score = 45;
      signals.push('low activity, no directional bias');
    }

    return {
      score: this.normalizeScore(score),
      signal: score >= 70 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'Default ranging regime',
      metadata: {
        regime,
        volumeSpike: Number(volumeSpike.toFixed(2)),
        txVelocity: Number(txVelocity.toFixed(2)),
        buyPressure: Number(buyPressure.toFixed(2)),
        price,
      },
    };
  }
}
