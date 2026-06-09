import { BaseEngine, EngineResult } from './baseEngine.js';
import { TransactionData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export class FeeVelocityEngine extends BaseEngine {
  readonly name = 'fee_velocity';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress;
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const now = Date.now();
    const timeframes = [5, 15, 30, 60];
    const feeData: Record<string, number> = {};
    const metadata: Record<string, unknown> = {};

    for (const min of timeframes) {
      const txs = await repositories.transaction.getRecent(poolAddress, min);
      const totalFees = txs.reduce((sum: number, tx: TransactionData) => sum + (tx.volumeUsd * 0.003), 0);
      feeData[`fee${min}m`] = totalFees;
      metadata[`fee${min}m`] = totalFees;
    }

    const fee5m = feeData['fee5m'] ?? 0;
    const fee15m = feeData['fee15m'] ?? 0;
    const fee30m = feeData['fee30m'] ?? 0;
    const fee1h = feeData['fee1h'] ?? 0;

    const feeVelocity = fee5m / 5;
    const feeAcceleration = fee5m > 0 && fee15m > 0
      ? (fee5m / 5) - (fee15m / 15)
      : 0;

    metadata.feeVelocity = feeVelocity;
    metadata.feeAcceleration = feeAcceleration;

    if (feeVelocity < 0 || (feeAcceleration < 0 && feeVelocity < 0.01)) {
      return { score: 0, signal: 'bearish', reason: 'Negative fee velocity - REJECTED', metadata };
    }

    const velocityScore = Math.min(feeVelocity * 20, 50);
    const accelerationScore = Math.max(0, Math.min(feeAcceleration * 50, 30));
    const consistencyScore = (fee5m > 0 && fee15m > 0 && fee30m > 0) ? 20 : fee5m > 0 ? 10 : 0;
    const score = this.normalizeScore(velocityScore + accelerationScore + consistencyScore);

    return {
      score,
      signal: this.getSignal(score),
      reason: `feeVelocity=${feeVelocity.toFixed(4)}/s, feeAcceleration=${feeAcceleration.toFixed(4)}/s`,
      metadata,
    };
  }
}
