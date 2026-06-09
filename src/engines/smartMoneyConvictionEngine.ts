import { BaseEngine, EngineResult } from './baseEngine.js';
import { HolderData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export class SmartMoneyConvictionEngine extends BaseEngine {
  readonly name = 'smart_money_conviction';
  readonly version = '1.0.0';

  private smartWalletTags = ['smart_money', 'kol', 'whale', 'early_investor', 'top_trader'];

  async evaluate(params?: { poolAddress?: string; tokenMint?: string }): Promise<EngineResult> {
    const { poolAddress, tokenMint } = params ?? {};
    if (!tokenMint) {
      return { score: 0, signal: 'bearish', reason: 'No token mint provided', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const holders = await repositories.holder.getByToken(tokenMint);

    const smartHolders = holders.filter((h: HolderData) =>
      h.tags.some((t: string) => this.smartWalletTags.includes(t))
    );

    const smartWalletCount = smartHolders.length;
    const smartWalletTotalPct = smartHolders.reduce((sum: number, h: HolderData) => sum + h.percentage, 0);

    const topSmartHolders = smartHolders
      .sort((a: HolderData, b: HolderData) => b.balance - a.balance)
      .slice(0, 5);

    const avgHoldDuration = await this.calculateAvgHoldDuration(tokenMint);

    let reEntryFreq = 0;
    if (poolAddress) {
      const smartTxs = await repositories.transaction.getSmartMoneyTransactions(poolAddress, 1440);
      reEntryFreq = smartTxs.length;
    }

    metadata.smartWalletCount = smartWalletCount;
    metadata.smartWalletTotalPct = smartWalletTotalPct;
    metadata.avgHoldDuration = avgHoldDuration;
    metadata.reEntryFrequency = reEntryFreq;

    const walletCountScore = Math.min(smartWalletCount * 15, 30);
    const concentrationScore = Math.min(smartWalletTotalPct * 2, 30);
    const holdDurationScore = Math.min((avgHoldDuration / (3600 * 1000)), 20);
    const reEntryScore = Math.min(reEntryFreq * 2, 20);

    const score = this.normalizeScore(walletCountScore + concentrationScore + holdDurationScore + reEntryScore);

    return {
      score,
      signal: this.getSignal(score),
      reason: `smartWallets=${smartWalletCount}, totalPct=${smartWalletTotalPct.toFixed(1)}%, avgHold=${(avgHoldDuration / (3600 * 1000)).toFixed(1)}h`,
      metadata,
    };
  }

  private async calculateAvgHoldDuration(tokenMint: string): Promise<number> {
    const holders = await repositories.holder.getByToken(tokenMint);
    if (holders.length === 0) return 0;
    const durations = holders
      .filter((h: HolderData) => h.firstSeen && h.lastSeen)
      .map((h: HolderData) => h.lastSeen.getTime() - h.firstSeen.getTime());
    if (durations.length === 0) return 0;
    return durations.reduce((sum: number, d: number) => sum + d, 0) / durations.length;
  }
}
