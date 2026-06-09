import { BaseIntegration } from '../baseIntegration.js';

export interface MeteoraDLMMPool {
  address: string;
  name: string;
  mintX: string;
  mintY: string;
  binStep: number;
  baseFee: number;
  feePct: number;
  activeBin: number;
  price: number;
  tvl: number;
  volume24h: number;
  fee24h: number;
  apr24h: number;
  apr7d: number;
  utilization: number;
  activeBins: number;
  totalBins: number;
  liquidityX: number;
  liquidityY: number;
  tokenX: { mint: string; symbol: string; name: string; decimals: number };
  tokenY: { mint: string; symbol: string; name: string; decimals: number };
}

export interface MeteoraPoolStats {
  address: string;
  tvl: number;
  volume24h: number;
  fee24h: number;
  feePerTvl24h: number;
  apr24h: number;
  apr7d: number;
  utilization: number;
  activeBins: number;
}

export class MeteoraAdapter extends BaseIntegration {
  readonly name = 'meteora';

  constructor() {
    super({
      baseUrl: 'https://dlmm-api.meteora.ag',
      timeout: 10000,
      maxRetries: 3,
      rateLimit: 500,
    });
  }

  async getAllPools(): Promise<MeteoraDLMMPool[]> {
    return this.apiFetch<MeteoraDLMMPool[]>('/pair/all');
  }

  async getPool(address: string): Promise<MeteoraDLMMPool> {
    return this.apiFetch<MeteoraDLMMPool>(`/pair/${address}`);
  }

  async getPoolStats(address: string): Promise<MeteoraPoolStats> {
    const pool = await this.getPool(address);
    return {
      address: pool.address,
      tvl: pool.tvl,
      volume24h: pool.volume24h,
      fee24h: pool.fee24h,
      feePerTvl24h: pool.fee24h > 0 && pool.tvl > 0 ? (pool.fee24h / pool.tvl) * 100 : 0,
      apr24h: pool.apr24h,
      apr7d: pool.apr7d,
      utilization: pool.utilization,
      activeBins: pool.activeBins,
    };
  }

  async getTopPools(limit = 50, sortBy: 'tvl' | 'volume' | 'apr' = 'apr'): Promise<MeteoraDLMMPool[]> {
    const pools = await this.getAllPools();
    const sorted = pools.sort((a, b) => {
      switch (sortBy) {
        case 'tvl': return b.tvl - a.tvl;
        case 'volume': return b.volume24h - a.volume24h;
        case 'apr': return (b.apr24h ?? 0) - (a.apr24h ?? 0);
        default: return 0;
      }
    });
    return sorted.slice(0, limit);
  }

  async getPoolsByToken(mint: string): Promise<MeteoraDLMMPool[]> {
    const pools = await this.getAllPools();
    return pools.filter(p =>
      p.mintX === mint || p.mintY === mint
    );
  }

  async getUtilization(address: string): Promise<number> {
    const pool = await this.getPool(address);
    return pool.utilization;
  }

  async getActiveBins(address: string): Promise<{ activeBin: number; totalBins: number; activeBins: number }> {
    const pool = await this.getPool(address);
    return {
      activeBin: pool.activeBin,
      totalBins: pool.totalBins,
      activeBins: pool.activeBins,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pools = await this.getAllPools();
      return Array.isArray(pools);
    } catch {
      return false;
    }
  }
}
