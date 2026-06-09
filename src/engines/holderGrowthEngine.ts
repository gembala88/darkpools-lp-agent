import { BaseEngine, EngineResult } from './baseEngine.js';
import { HolderData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export class HolderGrowthEngine extends BaseEngine {
  readonly name = 'holder_growth';
  readonly version = '1.0.0';

  async evaluate(params?: { tokenMint?: string }): Promise<EngineResult> {
    const tokenMint = params?.tokenMint;
    if (!tokenMint) {
      return { score: 0, signal: 'bearish', reason: 'No token mint provided', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const holders = await repositories.holder.getByToken(tokenMint);

    const now = new Date();
    const recent1h = holders.filter((h: HolderData) => h.firstSeen >= new Date(now.getTime() - 60 * 60_000));
    const recent4h = holders.filter((h: HolderData) => h.firstSeen >= new Date(now.getTime() - 4 * 60 * 60_000));
    const recent24h = holders.filter((h: HolderData) => h.firstSeen >= new Date(now.getTime() - 24 * 60 * 60_000));

    metadata.totalHolders = holders.length;
    metadata.newHolders1h = recent1h.length;
    metadata.newHolders4h = recent4h.length;
    metadata.newHolders24h = recent24h.length;

    const growth1h = holders.length > 0 ? (recent1h.length / holders.length) * 100 : 0;
    const growth4h = holders.length > 0 ? (recent4h.length / holders.length) * 100 : 0;

    const growthScore = (Math.max(0, growth1h) * 0.6) + (Math.max(0, growth4h) * 0.4);
    const totalBonus = Math.min(holders.length / 100, 20);
    const score = this.normalizeScore(Math.min(growthScore + totalBonus, 100));

    return {
      score,
      signal: this.getSignal(score),
      reason: `totalHolders=${holders.length}, new1h=${recent1h.length}, new4h=${recent4h.length}, growth1h=${growth1h.toFixed(2)}%`,
      metadata,
    };
  }
}
