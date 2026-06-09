import { BaseRepository } from './baseRepository.js';
import { HolderData, ValidationResult } from '../types/index.js';
import { Cache } from '../utils/cache.js';

export class HolderRepository extends BaseRepository<HolderData> {
  private holders: Map<string, HolderData> = new Map();
  private listCache = new Cache<HolderData[]>(30_000);

  async getByAddress(address: string, tokenMint: string): Promise<HolderData | null> {
    const key = `holder:${tokenMint}:${address}`;
    const cached = await this.getCached(key);
    if (cached) return cached;
    const holder = this.holders.get(key) ?? null;
    if (holder) this.setCache(key, holder);
    return holder;
  }

  async getByToken(tokenMint: string): Promise<HolderData[]> {
    const key = `holders:${tokenMint}`;
    const cached = this.listCache.get(key);
    if (cached) return cached;
    const holders = Array.from(this.holders.values())
      .filter(h => h.tokenMint === tokenMint);
    this.listCache.set(key, holders, 30_000);
    return holders;
  }

  async upsert(holder: HolderData): Promise<HolderData> {
    const key = `holder:${holder.tokenMint}:${holder.address}`;
    const existing = this.holders.get(key);
    const merged = existing ? this.reconcile(holder, existing) : holder;
    this.holders.set(key, merged);
    this.setCache(key, merged);
    this.listCache.delete(`holders:${holder.tokenMint}`);
    return merged;
  }

  validate(data: Partial<HolderData>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!data.address) errors.push('address is required');
    if (!data.tokenMint) errors.push('tokenMint is required');
    if (data.balance != null && data.balance < 0) errors.push('balance cannot be negative');
    if (data.percentage != null && (data.percentage < 0 || data.percentage > 100)) errors.push('percentage must be 0-100');
    return { valid: errors.length === 0, errors, warnings };
  }

  async refresh(key: string): Promise<HolderData | null> {
    this.invalidateCache(`holder:${key}`);
    const [tokenMint, address] = key.split(':');
    return this.getByAddress(address, tokenMint);
  }

  reconcile(remote: HolderData, local: HolderData): HolderData {
    return {
      ...local,
      ...remote,
      address: local.address,
      tokenMint: local.tokenMint,
      firstSeen: local.firstSeen,
      lastSeen: new Date(),
      transactionCount: remote.transactionCount ?? local.transactionCount,
      tags: [...new Set([...local.tags, ...(remote.tags ?? [])])],
    };
  }

  deduplicate(items: HolderData[]): HolderData[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = `${item.tokenMint}:${item.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async bulkUpsert(holders: HolderData[]): Promise<number> {
    const deduped = this.deduplicate(holders);
    let count = 0;
    for (const holder of deduped) {
      const validation = this.validate(holder);
      if (validation.valid) {
        await this.upsert(holder);
        count++;
      }
    }
    return count;
  }

  getTopHolders(tokenMint: string, limit = 10): HolderData[] {
    return Array.from(this.holders.values())
      .filter(h => h.tokenMint === tokenMint)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  }

  getConcentration(tokenMint: string): number {
    const holders = this.getTopHolders(tokenMint, 10);
    if (holders.length === 0) return 0;
    return holders.reduce((sum, h) => sum + h.percentage, 0);
  }
}
