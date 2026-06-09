import { BaseEngine, EngineResult } from './baseEngine.js';
import { TransactionData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export class HotPoolDetector extends BaseEngine {
  readonly name = 'hot_pool_detector';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string; tokenMint?: string }): Promise<EngineResult> {
    const { poolAddress, tokenMint } = params ?? {};
    if (!poolAddress || !tokenMint) {
      return { score: 0, signal: 'neutral', reason: 'Missing poolAddress or tokenMint', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};

    const txs5m = await repositories.transaction.getRecent(poolAddress, 5);
    const txs15m = await repositories.transaction.getRecent(poolAddress, 15);
    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);

    const volume5m = txs5m.reduce((s: number, t: TransactionData) => s + t.volumeUsd, 0);
    const volume15m = txs15m.reduce((s: number, t: TransactionData) => s + t.volumeUsd, 0);
    const volume1h = txs1h.reduce((s: number, t: TransactionData) => s + t.volumeUsd, 0);

    const uniqueTraders5m = new Set(txs5m.map((t: TransactionData) => t.walletAddress)).size;
    const uniqueTraders15m = new Set(txs15m.map((t: TransactionData) => t.walletAddress)).size;
    const uniqueTraders1h = new Set(txs1h.map((t: TransactionData) => t.walletAddress)).size;

    const holders = await repositories.holder.getByToken(tokenMint);
    const holderGrowth1h = this.calculateHolderGrowth(holders, 60);

    const liquidity = await repositories.liquidity.getLatest(poolAddress);
    const feeEstimate5m = volume5m * 0.003;
    const feeEstimate1h = volume1h * 0.003;

    metadata.volume5m = volume5m;
    metadata.volume15m = volume15m;
    metadata.volume1h = volume1h;
    metadata.txCount5m = txs5m.length;
    metadata.txCount15m = txs15m.length;
    metadata.txCount1h = txs1h.length;
    metadata.uniqueTraders5m = uniqueTraders5m;
    metadata.uniqueTraders15m = uniqueTraders15m;
    metadata.uniqueTraders1h = uniqueTraders1h;
    metadata.holderGrowth1h = holderGrowth1h;
    metadata.feeEstimate5m = feeEstimate5m;
    metadata.feeEstimate1h = feeEstimate1h;

    const volumeScore = Math.min((volume5m / 10000) * 25, 25);
    const txScore = Math.min((txs5m.length / 50) * 20, 20);
    const traderScore = Math.min((uniqueTraders5m / 100) * 20, 20);
    const holderScore = Math.min(Math.max(0, holderGrowth1h) * 0.5, 15);
    const feeScore = Math.min(feeEstimate5m * 10, 10);
    const consistencyScore = (txs5m.length > 0 && txs15m.length > 0 && txs1h.length > 0) ? 10 : 0;

    const score = this.normalizeScore(volumeScore + txScore + traderScore + holderScore + feeScore + consistencyScore);

    return {
      score,
      signal: this.getSignal(score),
      reason: `vol5m=${volume5m.toFixed(2)}, txs5m=${txs5m.length}, traders5m=${uniqueTraders5m}`,
      metadata,
    };
  }

  private calculateHolderGrowth(holders: { firstSeen: Date }[], minutes: number): number {
    const now = Date.now();
    const cutoff = now - minutes * 60_000;
    const newHolders = holders.filter(h => h.firstSeen.getTime() >= cutoff).length;
    return holders.length > 0 ? (newHolders / holders.length) * 100 : 0;
  }
}
