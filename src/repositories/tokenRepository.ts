import { BaseRepository } from './baseRepository.js';
import { TokenData, ValidationResult } from '../types/index.js';
import { Cache } from '../utils/cache.js';

export class TokenRepository extends BaseRepository<TokenData> {
  private tokens: Map<string, TokenData> = new Map();
  private listCache = new Cache<TokenData[]>(30_000);

  async getByMint(mint: string): Promise<TokenData | null> {
    const cached = await this.getCached(`token:${mint}`);
    if (cached) return cached;
    const token = this.tokens.get(mint) ?? null;
    if (token) this.setCache(`token:${mint}`, token);
    return token;
  }

  async upsert(token: TokenData): Promise<TokenData> {
    const existing = this.tokens.get(token.mint);
    const merged = existing ? this.reconcile(token, existing) : token;
    this.tokens.set(token.mint, merged);
    this.setCache(`token:${token.mint}`, merged);
    this.listCache.delete('tokens:list');
    return merged;
  }

  async getAll(): Promise<TokenData[]> {
    const cached = this.listCache.get('tokens:list');
    if (cached) return cached;
    const values = Array.from(this.tokens.values());
    this.listCache.set('tokens:list', values, 30_000);
    return values;
  }

  validate(data: Partial<TokenData>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.mint) errors.push('mint is required');
    if (data.liquidity != null && data.liquidity < 0) errors.push('liquidity must be >= 0');
    if (data.marketCap != null && data.marketCap < 0) errors.push('marketCap must be >= 0');
    if (data.holders != null && data.holders < 0) errors.push('holders count invalid');
    if (data.decimals != null && (data.decimals < 0 || data.decimals > 18)) warnings.push('unusual decimals value');

    return { valid: errors.length === 0, errors, warnings };
  }

  async refresh(key: string): Promise<TokenData | null> {
    this.invalidateCache(`token:${key}`);
    return this.getByMint(key);
  }

  reconcile(remote: TokenData, local: TokenData): TokenData {
    return {
      ...local,
      ...remote,
      mint: local.mint,
      createdAt: local.createdAt,
      updatedAt: new Date(),
      holders: remote.holders ?? local.holders,
      volume24h: remote.volume24h ?? local.volume24h,
      liquidity: remote.liquidity ?? local.liquidity,
      marketCap: remote.marketCap ?? local.marketCap,
      price: remote.price ?? local.price,
    };
  }

  deduplicate(items: TokenData[]): TokenData[] {
    const seen = new Set<string>();
    return items.filter(item => {
      if (seen.has(item.mint)) return false;
      seen.add(item.mint);
      return true;
    });
  }

  async bulkUpsert(tokens: TokenData[]): Promise<number> {
    const deduped = this.deduplicate(tokens);
    let count = 0;
    for (const token of deduped) {
      const validation = this.validate(token);
      if (validation.valid) {
        await this.upsert(token);
        count++;
      }
    }
    return count;
  }

  async delete(mint: string): Promise<boolean> {
    const existed = this.tokens.delete(mint);
    this.invalidateCache(`token:${mint}`);
    this.listCache.delete('tokens:list');
    return existed;
  }
}
