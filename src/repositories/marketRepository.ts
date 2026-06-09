import { BaseRepository } from './baseRepository.js';
import { MarketData, ValidationResult } from '../types/index.js';

export class MarketRepository extends BaseRepository<MarketData> {
  private snapshots: MarketData[] = [];
  private maxSnapshots = 5000;

  async getLatest(poolAddress: string): Promise<MarketData | null> {
    const key = `mkt:latest:${poolAddress}`;
    const cached = await this.getCached(key);
    if (cached) return cached;
    const latest = this.snapshots
      .filter(s => s.poolAddress === poolAddress)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] ?? null;
    if (latest) this.setCache(key, latest, 15_000);
    return latest;
  }

  async getHistory(poolAddress: string, from: Date, to: Date): Promise<MarketData[]> {
    return this.snapshots.filter(s =>
      s.poolAddress === poolAddress &&
      s.timestamp >= from &&
      s.timestamp <= to
    ).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async getVolumeTrend(poolAddress: string, minutes: number): Promise<{
    current: number;
    previous: number;
    changePercent: number;
    trending: 'up' | 'down' | 'stable';
  }> {
    const now = new Date();
    const interval = new Date(now.getTime() - minutes * 60_000);
    const snapshots = await this.getHistory(poolAddress, interval, now);
    if (snapshots.length < 2) {
      return { current: 0, previous: 0, changePercent: 0, trending: 'stable' };
    }
    const recent = snapshots.slice(-Math.min(5, snapshots.length));
    const current = recent.reduce((s, m) => s + m.volume5m, 0) / recent.length;
    const older = snapshots.slice(0, Math.min(5, snapshots.length));
    const previous = older.reduce((s, m) => s + m.volume5m, 0) / older.length;
    const changePercent = previous > 0 ? ((current - previous) / previous) * 100 : 0;
    const trending = changePercent > 10 ? 'up' : changePercent < -10 ? 'down' : 'stable';
    return { current, previous, changePercent, trending };
  }

  async add(data: MarketData): Promise<void> {
    this.snapshots.push(data);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }
    this.invalidateCache(`mkt:latest:${data.poolAddress}`);
  }

  getBuySellRatio(poolAddress: string): number {
    const latest = this.snapshots
      .filter(s => s.poolAddress === poolAddress)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    if (!latest) return 1;
    return latest.buyVolume5m > 0 ? latest.buyVolume5m / (latest.sellVolume5m || 1) : 1;
  }

  getTransactionVelocity(poolAddress: string): number {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    const recent = this.snapshots.filter(s =>
      s.poolAddress === poolAddress && s.timestamp >= fiveMinAgo
    );
    if (recent.length === 0) return 0;
    const totalTx = recent.reduce((s, m) => s + m.txCount5m, 0);
    return totalTx / 5;
  }

  validate(data: Partial<MarketData>): ValidationResult {
    const errors: string[] = [];
    if (!data.poolAddress) errors.push('poolAddress is required');
    if (!data.tokenMint) errors.push('tokenMint is required');
    if (data.volume5m != null && data.volume5m < 0) errors.push('volume cannot be negative');
    if (data.txCount5m != null && data.txCount5m < 0) errors.push('tx count cannot be negative');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async refresh(key: string): Promise<MarketData | null> {
    this.invalidateCache(`mkt:latest:${key}`);
    return this.getLatest(key);
  }

  reconcile(remote: MarketData, local: MarketData): MarketData {
    return { ...remote, poolAddress: local.poolAddress, tokenMint: local.tokenMint };
  }

  deduplicate(items: MarketData[]): MarketData[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = `${item.poolAddress}:${item.timestamp.getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  getUniqueTraderGrowth(poolAddress: string): number {
    const now = new Date();
    const recent = new Date(now.getTime() - 60 * 60_000);
    const older = new Date(now.getTime() - 4 * 60 * 60_000);
    const recentTraders = this.snapshots
      .filter(s => s.poolAddress === poolAddress && s.timestamp >= recent)
      .reduce((max, s) => Math.max(max, s.uniqueTraders1h), 0);
    const olderTraders = this.snapshots
      .filter(s => s.poolAddress === poolAddress && s.timestamp >= older && s.timestamp < recent)
      .reduce((max, s) => Math.max(max, s.uniqueTraders4h), 0);
    return olderTraders > 0 ? ((recentTraders - olderTraders) / olderTraders) * 100 : 0;
  }
}
