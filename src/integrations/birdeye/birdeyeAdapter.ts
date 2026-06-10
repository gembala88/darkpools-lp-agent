import { BaseIntegration } from '../baseIntegration.js';
import { Cache } from '../../utils/cache.js';

export interface BirdeyeTokenOverview {
  mint: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  holders: number;
  decimals: number;
}

export interface BirdeyeHolder {
  address: string;
  balance: number;
  percentage: number;
  tags: string[];
}

export interface BirdeyeTransaction {
  signature: string;
  type: 'buy' | 'sell';
  amount: number;
  volumeUsd: number;
  price: number;
  walletAddress: string;
  timestamp: number;
}

export interface BirdeyeMarketData {
  mint: string;
  price: number;
  volume5m: number;
  volume15m: number;
  volume30m: number;
  volume1h: number;
  volume24h: number;
  txCount5m: number;
  txCount15m: number;
  txCount30m: number;
  txCount1h: number;
  buyVolume5m: number;
  sellVolume5m: number;
  uniqueTraders5m: number;
  uniqueTraders15m: number;
  uniqueTraders1h: number;
}

export class BirdeyeAdapter extends BaseIntegration {
  readonly name = 'birdeye';
  private holderCache = new Cache<BirdeyeHolder[]>(10 * 60 * 1000);

  constructor(apiKey?: string) {
    super({
      apiKey,
      baseUrl: 'https://public-api.birdeye.so',
      timeout: 10000,
      maxRetries: 3,
      rateLimit: 500,
    });
  }

  protected async apiFetch<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const raw = await super.apiFetch<Record<string, unknown>>(endpoint, params);
    if (raw && typeof raw === 'object' && 'success' in raw && 'data' in raw) {
      return (raw as { data: T }).data;
    }
    return raw as T;
  }

  async getTokenOverview(mint: string): Promise<BirdeyeTokenOverview> {
    return this.apiFetch<BirdeyeTokenOverview>(`/defi/token_overview`, { address: mint });
  }

  async getTokenHolders(mint: string, limit = 100): Promise<BirdeyeHolder[]> {
    const cacheKey = `holders:${mint}:${limit}`;
    const cached = this.holderCache.get(cacheKey);
    if (cached) return cached;

    const parseRaw = (raw: Record<string, unknown> | BirdeyeHolder[]): BirdeyeHolder[] => {
      console.log('[holder-debug]', JSON.stringify(raw).slice(0, 500));
      if (Array.isArray(raw)) return raw;
      const items = (raw as Record<string, unknown>)?.items;
      console.log('[holder-debug] items array?', Array.isArray(items), 'length:', Array.isArray(items) ? items.length : 'N/A');
      if (!Array.isArray(items)) return [];
      return (items as Array<Record<string, unknown>>).map((item) => ({
        address: String(item.address ?? ''),
        balance: Number(item.amount ?? 0),
        percentage: Number(item.percentage ?? 0),
        tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
      }));
    };

    try {
      const raw = await this.apiFetch<Record<string, unknown> | BirdeyeHolder[]>(
        `/defi/v3/token/holder`, { address: mint, offset: 0, limit }
      );
      const result = parseRaw(raw);
      this.holderCache.set(cacheKey, result);
      return result;
    } catch (err) {
      if (err instanceof Error && err.message?.includes('401')) {
        console.log('[holder-debug] Birdeye 401 on /defi/v3/token/holder, falling back to Jupiter DatAPI');
        const jupResult = await this.fetchFromJupiterHolders(mint, limit);
        this.holderCache.set(cacheKey, jupResult);
        return jupResult;
      }
      throw err;
    }
  }

  private async fetchFromJupiterHolders(mint: string, limit: number): Promise<BirdeyeHolder[]> {
    const res = await fetch(`https://datapi.jup.ag/v1/holders/${mint}?limit=${limit}`);
    if (!res.ok) throw new Error(`Jupiter holders HTTP ${res.status}`);
    const data: any = await res.json();
    const items = Array.isArray(data) ? data : (data?.holders ?? []);
    return items.map((item: Record<string, unknown>) => ({
      address: String(item.address ?? ''),
      balance: Number(item.amount ?? item.balance ?? 0),
      percentage: Number(item.percentage ?? item.pct ?? 0),
      tags: [],
    }));
  }

  async getTokenTransactions(mint: string, limit = 100): Promise<BirdeyeTransaction[]> {
    const raw = await this.apiFetch<Record<string, unknown> | BirdeyeTransaction[]>(`/defi/txs/token`, { address: mint, limit });
    if (Array.isArray(raw)) return raw;
    const txns = (raw as Record<string, unknown>)?.txns;
    return Array.isArray(txns) ? txns as BirdeyeTransaction[] : [];
  }

  async getTokenMarketData(mint: string): Promise<BirdeyeMarketData> {
    return this.apiFetch<BirdeyeMarketData>(`/defi/token_market_data`, { address: mint });
  }

  async getTokenSecurity(mint: string): Promise<Record<string, unknown>> {
    return this.apiFetch<Record<string, unknown>>(`/defi/token_security`, { address: mint });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.apiFetch<{ success: boolean }>('/defi/health');
      return true;
    } catch {
      return false;
    }
  }
}
