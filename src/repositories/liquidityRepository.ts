import { BaseRepository } from './baseRepository.js';
import { LiquiditySnapshot, ValidationResult } from '../types/index.js';

export class LiquidityRepository extends BaseRepository<LiquiditySnapshot> {
  private snapshots: LiquiditySnapshot[] = [];
  private maxSnapshots = 10000;

  async getLatest(poolAddress: string): Promise<LiquiditySnapshot | null> {
    const key = `liq:latest:${poolAddress}`;
    const cached = await this.getCached(key);
    if (cached) return cached;
    const latest = this.snapshots
      .filter(s => s.poolAddress === poolAddress)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] ?? null;
    if (latest) this.setCache(key, latest, 15_000);
    return latest;
  }

  async getHistory(poolAddress: string, from: Date, to: Date): Promise<LiquiditySnapshot[]> {
    return this.snapshots.filter(s =>
      s.poolAddress === poolAddress &&
      s.timestamp >= from &&
      s.timestamp <= to
    ).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async getAggregated(poolAddress: string, minutes: number): Promise<{
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  }> {
    const now = new Date();
    const interval = new Date(now.getTime() - minutes * 60_000);
    const snapshots = await this.getHistory(poolAddress, interval, now);
    if (snapshots.length < 2) {
      return { current: 0, previous: 0, change: 0, changePercent: 0 };
    }
    const current = snapshots[snapshots.length - 1].liquidity;
    const previous = snapshots[0].liquidity;
    const change = current - previous;
    const changePercent = previous > 0 ? (change / previous) * 100 : 0;
    return { current, previous, change, changePercent };
  }

  async add(snapshot: LiquiditySnapshot): Promise<void> {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }
    this.invalidateCache(`liq:latest:${snapshot.poolAddress}`);
    this.invalidateCacheByPattern(new RegExp(`liq:history:${snapshot.poolAddress}`));
  }

  validate(data: Partial<LiquiditySnapshot>): ValidationResult {
    const errors: string[] = [];
    if (!data.poolAddress) errors.push('poolAddress is required');
    if (!data.tokenMint) errors.push('tokenMint is required');
    if (data.liquidity != null && data.liquidity <= 0) errors.push('liquidity must be > 0');
    if (data.tvl != null && data.tvl <= 0) errors.push('tvl must be > 0');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async refresh(key: string): Promise<LiquiditySnapshot | null> {
    this.invalidateCache(`liq:latest:${key}`);
    return this.getLatest(key);
  }

  reconcile(remote: LiquiditySnapshot, local: LiquiditySnapshot): LiquiditySnapshot {
    return { ...remote, poolAddress: local.poolAddress, tokenMint: local.tokenMint };
  }

  deduplicate(items: LiquiditySnapshot[]): LiquiditySnapshot[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = `${item.poolAddress}:${item.timestamp.getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  isDraining(poolAddress: string, thresholdPercent: number): boolean {
    const snapshots = this.snapshots
      .filter(s => s.poolAddress === poolAddress)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    if (snapshots.length < 2) return false;
    const recent = snapshots[0];
    const older = snapshots[snapshots.length - 1];
    const drop = ((older.liquidity - recent.liquidity) / older.liquidity) * 100;
    return drop > thresholdPercent;
  }

  clear(): void {
    this.snapshots = [];
    this.cache.clear();
  }
}
