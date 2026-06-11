import { BaseEngine, EngineResult } from './baseEngine.js';
import { HolderData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

interface HolderSnapshot {
  count: number;
  timestamp: number;
}

export class HolderGrowthEngine extends BaseEngine {
  readonly name = 'holder_growth';
  readonly version = '1.0.0';

  private loadSnapshots(): Record<string, HolderSnapshot> {
    try {
      const fs = require('fs') as typeof import('fs');
      const p = require('path') as typeof import('path');
      const snapshotPath = p.join(process.cwd(), 'data', 'holder-snapshots.json');
      if (fs.existsSync(snapshotPath)) {
        return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      }
    } catch { /* no snapshots yet */ }
    return {};
  }

  async evaluate(params?: { tokenMint?: string }): Promise<EngineResult> {
    const tokenMint = params?.tokenMint;
    if (!tokenMint) {
      return { score: 0, signal: 'bearish', reason: 'No token mint provided', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const holders = await repositories.holder.getByToken(tokenMint);
    const currentCount = holders.length;

    // Load historical snapshots for real growth data
    const snapshots = this.loadSnapshots();
    const snapshot = snapshots[tokenMint];

    let growth1h = 0;
    let growth4h = 0;
    let hasSnapshot = false;

    if (snapshot) {
      hasSnapshot = true;
      const ageMs = Date.now() - snapshot.timestamp;
      const ageHours = ageMs / (60 * 60 * 1000);
      metadata.snapshotCount = snapshot.count;
      metadata.snapshotAgeHours = Math.round(ageHours * 10) / 10;

      if (currentCount > 0 && snapshot.count > 0) {
        const diff = currentCount - snapshot.count;
        if (ageHours <= 2) {
          growth1h = (diff / snapshot.count) * 100;
        } else if (ageHours <= 6) {
          growth4h = (diff / snapshot.count) * 100;
        } else {
          growth1h = (diff / snapshot.count) * 100;
        }
      }
    }

    // Also try in-memory firstSeen data (available within same process)
    const now = new Date();
    const recent1h = holders.filter((h: HolderData) => h.firstSeen >= new Date(now.getTime() - 60 * 60_000));
    const recent4h = holders.filter((h: HolderData) => h.firstSeen >= new Date(now.getTime() - 4 * 60 * 60_000));
    const recent24h = holders.filter((h: HolderData) => h.firstSeen >= new Date(now.getTime() - 24 * 60 * 60_000));

    metadata.totalHolders = currentCount;
    metadata.newHolders1h = recent1h.length;
    metadata.newHolders4h = recent4h.length;
    metadata.newHolders24h = recent24h.length;
    metadata.hasSnapshot = hasSnapshot;

    // Use snapshot-based growth if available, else fall back to firstSeen
    const effectiveGrowth1h = growth1h > 0 ? growth1h : currentCount > 0 ? (recent1h.length / currentCount) * 100 : 0;
    const effectiveGrowth4h = growth4h > 0 ? growth4h : currentCount > 0 ? (recent4h.length / currentCount) * 100 : 0;

    const growthScore = (Math.max(0, effectiveGrowth1h) * 0.6) + (Math.max(0, effectiveGrowth4h) * 0.4);
    const totalBonus = Math.min(currentCount / 100, 20);
    const score = this.normalizeScore(Math.min(growthScore + totalBonus, 100));

    return {
      score,
      signal: this.getSignal(score),
      reason: `total=${currentCount} snap=${snapshot?.count ?? 'N/A'} growth1h=${effectiveGrowth1h.toFixed(2)}% growth4h=${effectiveGrowth4h.toFixed(2)}%${hasSnapshot ? ' (from snapshot)' : ''}`,
      metadata,
    };
  }
}