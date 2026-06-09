import { RepositoryCacheEntry, RepositoryConfig, ValidationResult } from '../types/index.js';

export abstract class BaseRepository<T> {
  protected cache: Map<string, RepositoryCacheEntry<T>> = new Map();
  protected config: RepositoryConfig;

  constructor(config?: Partial<RepositoryConfig>) {
    this.config = {
      defaultTTL: config?.defaultTTL ?? 60_000,
      maxRetries: config?.maxRetries ?? 3,
      enableCache: config?.enableCache ?? true,
    };
  }

  protected async getCached(key: string): Promise<T | null> {
    if (!this.config.enableCache) return null;
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt.getTime() > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  protected setCache(key: string, data: T, ttl?: number): void {
    if (!this.config.enableCache) return;
    this.cache.set(key, {
      data,
      fetchedAt: new Date(),
      ttl: ttl ?? this.config.defaultTTL,
    });
  }

  protected invalidateCache(key: string): void {
    this.cache.delete(key);
  }

  protected invalidateCacheByPattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  protected async withRetry<R>(fn: () => Promise<R>): Promise<R> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError ?? new Error('Operation failed');
  }

  abstract validate(data: Partial<T>): ValidationResult;

  abstract refresh(key: string): Promise<T | null>;

  abstract reconcile(remote: T, local: T): T;

  abstract deduplicate(items: T[]): T[];
}
