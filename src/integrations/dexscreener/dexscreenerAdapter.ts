import { BaseIntegration } from '../baseIntegration.js';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  price: { usd: string; native: string };
  liquidity: { usd: number; base: number; quote: number };
  volume: { h24: number; h6: number; h1: number; m5: number };
  txCount: { h24: number; h6: number; h1: number; m5: number };
  buySellRatio: { h24: number; h6: number; h1: number; m5: number };
  pairCreatedAt: number;
  fdv: number;
  marketCap: number;
}

export interface DexScreenerSearchResult {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export class DexScreenerAdapter extends BaseIntegration {
  readonly name = 'dexscreener';

  constructor() {
    super({
      baseUrl: 'https://api.dexscreener.com',
      timeout: 8000,
      maxRetries: 3,
      rateLimit: 300,
    });
  }

  async searchPairs(query: string): Promise<DexScreenerSearchResult> {
    return this.apiFetch<DexScreenerSearchResult>(`/latest/dex/search`, { q: query });
  }

  async getPairsByChain(chain: string, pairAddress: string): Promise<DexScreenerPair> {
    const result = await this.apiFetch<{ pairs: DexScreenerPair[] }>(
      `/latest/dex/pairs/${chain}/${pairAddress}`
    );
    return result.pairs[0];
  }

  async getTokenPairs(chain: string, tokenAddress: string): Promise<DexScreenerPair[]> {
    const result = await this.apiFetch<{ pairs: DexScreenerPair[] }>(
      `/token-pairs/v1/${chain}/${tokenAddress}`
    );
    return result.pairs;
  }

  async getPairActivity(pairAddress: string): Promise<{
    txCount: { h24: number; h1: number; m5: number };
    buySellRatio: { h24: number; h1: number; m5: number };
    liquidityMovement: number;
  }> {
    const pairs = await this.searchPairs(pairAddress);
    const pair = pairs.pairs[0];
    if (!pair) throw new Error(`Pair not found: ${pairAddress}`);
    return {
      txCount: {
        h24: pair.txCount.h24,
        h1: pair.txCount.h1,
        m5: pair.txCount.m5,
      },
      buySellRatio: {
        h24: pair.buySellRatio.h24,
        h1: pair.buySellRatio.h1,
        m5: pair.buySellRatio.m5,
      },
      liquidityMovement: pair.liquidity.usd,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.apiFetch<{ pairs: DexScreenerPair[] }>(
        '/latest/dex/search', { q: 'So11111111111111111111111111111111111111112' }
      );
      return Array.isArray(result.pairs);
    } catch {
      return false;
    }
  }
}
