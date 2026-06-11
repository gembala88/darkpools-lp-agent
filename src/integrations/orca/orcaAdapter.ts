import { BaseIntegration } from '../baseIntegration.js';

export interface OrcaWhirlpool {
  address: string;
  tokenA: { mint: string; symbol: string; decimals: number };
  tokenB: { mint: string; symbol: string; decimals: number };
  tvl: number;
  volume: { day: number; week: number };
  feeApr: number;
  price: number;
  tickSpacing: number;
}

export interface OrcaWhirlpoolListResponse {
  whirlpools: OrcaWhirlpool[];
}

export class OrcaAdapter extends BaseIntegration {
  readonly name = 'orca';

  constructor() {
    super({
      baseUrl: 'https://api.mainnet.orca.so',
      timeout: 10000,
      maxRetries: 2,
      rateLimit: 1000,
    });
  }

  async getWhirlpools(): Promise<OrcaWhirlpool[]> {
    const data = await this.apiFetch<OrcaWhirlpoolListResponse>('/v1/whirlpool/list');
    return data?.whirlpools ?? [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pools = await this.getWhirlpools();
      return Array.isArray(pools);
    } catch {
      return false;
    }
  }
}
