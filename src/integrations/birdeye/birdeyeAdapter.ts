import { BaseIntegration } from '../baseIntegration.js';

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

  constructor(apiKey?: string) {
    super({
      apiKey,
      baseUrl: 'https://public-api.birdeye.so',
      timeout: 10000,
      maxRetries: 3,
      rateLimit: 500,
    });
  }

  async getTokenOverview(mint: string): Promise<BirdeyeTokenOverview> {
    return this.apiFetch<BirdeyeTokenOverview>(`/defi/token_overview`, { address: mint });
  }

  async getTokenHolders(mint: string, limit = 100): Promise<BirdeyeHolder[]> {
    return this.apiFetch<BirdeyeHolder[]>(`/defi/token_holders`, { address: mint, limit });
  }

  async getTokenTransactions(mint: string, limit = 100): Promise<BirdeyeTransaction[]> {
    return this.apiFetch<BirdeyeTransaction[]>(`/defi/txs/token`, { address: mint, limit });
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
