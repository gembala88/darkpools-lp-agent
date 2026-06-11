import { BaseIntegration } from '../baseIntegration.js';

export interface RaydiumPoolInfo {
  poolId: string;
  name: string;
  mintA: { address: string; symbol: string; decimals: number };
  mintB: { address: string; symbol: string; decimals: number };
  tvl: number;
  volume24h: number;
  feeApr: number;
  day: { volume: number; feeApr: number; volumeFee: number };
  price: number;
}

export interface RaydiumPoolListResponse {
  data: {
    count: number;
    pools: RaydiumPoolInfo[];
  };
}

export class RaydiumAdapter extends BaseIntegration {
  readonly name = 'raydium';

  constructor() {
    super({
      baseUrl: 'https://api-v3.raydium.io',
      timeout: 10000,
      maxRetries: 2,
      rateLimit: 1000,
    });
  }

  async getConcentratedPools(page = 1, pageSize = 50): Promise<RaydiumPoolInfo[]> {
    const data = await this.apiFetch<RaydiumPoolListResponse>(
      '/pools/info/list',
      {
        poolType: 'concentrated',
        sort: 'volume24h',
        order: 'desc',
        pageSize,
        page,
      }
    );
    return data?.data?.pools ?? [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pools = await this.getConcentratedPools(1, 1);
      return Array.isArray(pools);
    } catch {
      return false;
    }
  }
}
