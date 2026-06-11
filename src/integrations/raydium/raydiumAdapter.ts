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

  async getConcentratedPools(page = 1, pageSize = 20): Promise<RaydiumPoolInfo[]> {
    try {
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // On 500 error, wait 2s and retry once
      if (msg.includes('500') || msg.includes('Internal Server Error')) {
        console.log(`[${this.name}] HTTP 500, retrying in 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
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
          console.log(`[${this.name}] Retry succeeded`);
          return data?.data?.pools ?? [];
        } catch (retryError) {
          console.log(`[${this.name}] Retry also failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
          return [];
        }
      }
      console.log(`[${this.name}] getConcentratedPools failed (non-500): ${msg}`);
      return [];
    }
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
