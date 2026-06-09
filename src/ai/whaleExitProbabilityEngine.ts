import { BaseEngine } from '../engines/baseEngine.js';
import { repositories } from '../repositories/index.js';

export class WhaleExitProbabilityEngine extends BaseEngine {
  readonly name = 'WhaleExitProbabilityEngine';
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
      return { score: 0, signal: 'bearish', reason: 'No pool address', metadata: { exitProbability: 0 } };
    }

    const [marketData, recentTxs] = await Promise.all([
      repositories.market.getLatest(poolAddress),
      repositories.transaction.getRecent(poolAddress, 60),
    ]);

    const top5Holders = repositories.holder.getTopHolders(tokenMint, 5);
    const top10Holders = repositories.holder.getTopHolders(tokenMint, 10);

    const top5Concentration = top5Holders.reduce((s, h) => s + h.percentage, 0);
    const top10Concentration = top10Holders.reduce((s, h) => s + h.percentage, 0);

    const whaleSells = recentTxs.filter(t =>
      t.type === 'sell' && t.volumeUsd > 5000
    );
    const whaleSellVolume = whaleSells.reduce((s, t) => s + t.volumeUsd, 0);
    const totalSellVolume = recentTxs.filter(t => t.type === 'sell').reduce((s, t) => s + t.volumeUsd, 0);

    const topHolderSells = top5Holders.filter(h => {
      return recentTxs.some(t => t.walletAddress === h.address && t.type === 'sell' && t.volumeUsd > 1000);
    }).length;

    const activityScore = params?.activityScore as number | undefined;

    let exitProbability = 0;
    const signals: string[] = [];

    const concentrationWeight = activityScore !== undefined && activityScore < 20 ? 0.5 : 1.0;

    if (top5Concentration >= 35) {
      exitProbability += 25 * concentrationWeight;
      signals.push('high top-5 concentration');
    }

    if (topHolderSells >= 3) {
      exitProbability += 30;
      signals.push('multiple top holders selling');
    } else if (topHolderSells >= 1) {
      exitProbability += 10;
      signals.push('top holder selling detected');
    }

    if (totalSellVolume > 0) {
      const whaleSellRatio = whaleSellVolume / totalSellVolume;
      if (whaleSellRatio > 0.5) {
        exitProbability += 20;
        signals.push('whale-dominated sell volume');
      }
    }

    if (totalSellVolume > 50000) {
      exitProbability += 20;
      signals.push('high total sell volume');
    }

    const buyVol = recentTxs.filter(t => t.type === 'buy').reduce((s, t) => s + t.volumeUsd, 0);
    if (totalSellVolume > buyVol * 2 && totalSellVolume > 30000) {
      exitProbability += 20;
      signals.push('sell pressure greatly exceeds buy pressure');
    }

    if (top10Concentration >= 60) {
      exitProbability += 15 * concentrationWeight;
      signals.push('extreme top-10 concentration');
    }

    if (activityScore !== undefined && activityScore < 20) {
      exitProbability *= 0.5;
      signals.push('low pool activity reduces exit probability weight');
    }

    exitProbability = Math.min(100, exitProbability);

    const score = 100 - exitProbability;

    return {
      score: this.normalizeScore(score),
      signal: exitProbability > 60 ? 'bearish' : exitProbability < 25 ? 'bullish' : 'neutral',
      reason: signals.join('; ') || `No significant whale exit indicators, score=${this.normalizeScore(score).toFixed(0)}`,
      metadata: {
        exitProbability: Number(exitProbability.toFixed(1)),
        top5Concentration: Number(top5Concentration.toFixed(1)),
        top10Concentration: Number(top10Concentration.toFixed(1)),
        topHolderSellsLastHour: topHolderSells,
        whaleSellVolume: Number(whaleSellVolume.toFixed(2)),
      },
    };
  }
}
