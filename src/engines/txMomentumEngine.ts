import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export class TxMomentumEngine extends BaseEngine {
  readonly name = 'tx_momentum';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string; tokenMint?: string }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress;
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const now = Date.now();
    const timeframes = [5, 15, 30, 60];
    const txData: Record<string, number> = {};
    const metadata: Record<string, unknown> = {};

    for (const min of timeframes) {
      const txs = await repositories.transaction.getRecent(poolAddress, min);
      const count = txs.length;
      txData[`txCount${min}m`] = count;

      if (min === 5) {
        const prev = await repositories.transaction.getRecent(poolAddress, 10);
        const prevCount = prev.length - count;
        metadata.txVelocity = count / 5;
        metadata.txAcceleration = count - Math.max(0, prevCount);
        metadata.txTrend = count > prevCount ? 'up' : count < prevCount ? 'down' : 'stable';
      }
    }

    const velocity = (metadata.txVelocity as number) ?? 0;
    const acceleration = (metadata.txAcceleration as number) ?? 0;
    const trend = metadata.txTrend as string;

    if (trend === 'down' && acceleration < 0) {
      return { score: 0, signal: 'bearish', reason: 'Negative tx trend detected - REJECTED', metadata };
    }

    const baseScore = Math.min(velocity * 10, 50);
    const accelBonus = Math.max(0, Math.min(acceleration * 5, 30));
    const trendBonus = trend === 'up' ? 20 : trend === 'stable' ? 10 : 0;

    const score = this.normalizeScore(baseScore + accelBonus + trendBonus);
    return { score, signal: this.getSignal(score), reason: `tx velocity=${velocity.toFixed(2)}/s, acceleration=${acceleration.toFixed(2)}`, metadata };
  }
}
