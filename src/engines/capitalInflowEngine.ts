import { BaseEngine, EngineResult } from './baseEngine.js';
import { HolderData, TransactionData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export class CapitalInflowEngine extends BaseEngine {
  readonly name = 'capital_inflow';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string; tokenMint?: string }): Promise<EngineResult> {
    const { poolAddress, tokenMint } = params ?? {};
    if (!poolAddress || !tokenMint) {
      return { score: 0, signal: 'bearish', reason: 'Missing poolAddress or tokenMint', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const timeframes = [30, 60, 240];

    let hasInflow = false;
    let inflowScore = 0;

    for (const min of timeframes) {
      const newWallets = await this.getNewWallets(tokenMint, min);
      const volume = await this.getNewVolume(poolAddress, min);
      const liquidity = await this.getNewLiquidity(poolAddress, min);

      metadata[`newWallets${min}m`] = newWallets;
      metadata[`newVolume${min}m`] = volume;
      metadata[`newLiquidity${min}m`] = liquidity;

      if (newWallets > 0 || volume > 0 || liquidity > 0) {
        hasInflow = true;
      }

      const timeframeWeight = min === 30 ? 0.5 : min === 60 ? 0.3 : 0.2;
      inflowScore += (
        (Math.min(newWallets * 5, 30) * timeframeWeight) +
        (Math.min(volume / 1000, 30) * timeframeWeight) +
        (Math.min(liquidity / 1000, 40) * timeframeWeight)
      );
    }

    if (!hasInflow) {
      return { score: 0, signal: 'bearish', reason: 'No capital inflow detected - REJECTED', metadata };
    }

    const score = this.normalizeScore(Math.min(inflowScore, 100));

    return {
      score,
      signal: this.getSignal(score),
      reason: `newWallets=${metadata['newWallets30m']}, volume=${metadata['newVolume30m']}, liquidity=${metadata['newLiquidity30m']}`,
      metadata,
    };
  }

  private async getNewWallets(tokenMint: string, minutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const holders = await repositories.holder.getByToken(tokenMint);
    return holders.filter((h: HolderData) => h.firstSeen >= cutoff).length;
  }

  private async getNewVolume(poolAddress: string, minutes: number): Promise<number> {
    const txs = await repositories.transaction.getRecent(poolAddress, minutes);
    return txs.reduce((sum: number, tx: TransactionData) => sum + tx.volumeUsd, 0);
  }

  private async getNewLiquidity(poolAddress: string, minutes: number): Promise<number> {
    const aggregated = await repositories.liquidity.getAggregated(poolAddress, minutes);
    return Math.max(0, aggregated.change);
  }
}
