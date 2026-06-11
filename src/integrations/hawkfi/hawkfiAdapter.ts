import { BaseIntegration } from '../baseIntegration.js';

export interface HawkFiPortfolio {
  wallet: string;
  totalValue: number;
  pools: Array<{
    poolAddress: string;
    poolName: string;
    value: number;
    unclaimedFees: number;
    apr: number;
  }>;
}

export interface HawkFiPoolScore {
  poolAddress: string;
  score: number;
  smartWalletCount: number;
  recentEntries: number;
  recentExits: number;
}

export class HawkFiAdapter extends BaseIntegration {
  readonly name = 'hawkfi';

  constructor() {
    super({
      baseUrl: 'https://api2.hawksight.co',
      timeout: 10000,
      maxRetries: 2,
      rateLimit: 1000,
    });
  }

  async getPortfolio(wallet: string): Promise<HawkFiPortfolio | null> {
    try {
      const data = await this.apiFetch<HawkFiPortfolio>(
        `/v1/general/portfolio?wallet=${wallet}`
      );
      return data;
    } catch {
      return null;
    }
  }

  async getPoolScores(): Promise<HawkFiPoolScore[]> {
    try {
      const data = await this.apiFetch<{ pools: HawkFiPoolScore[] }>(
        '/v1/meteora/pools'
      );
      return data?.pools ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Check if a specific pool has smart LP activity.
   * Returns { walletCount, entries, exits, score } or null.
   */
  async getPoolIntelligence(poolAddress: string): Promise<{
    walletCount: number;
    recentEntries: number;
    recentExits: number;
    score: number | null;
  } | null> {
    try {
      const pools = await this.getPoolScores();
      const match = pools.find(p =>
        p.poolAddress.toLowerCase() === poolAddress.toLowerCase()
      );
      if (!match) return null;
      return {
        walletCount: match.smartWalletCount,
        recentEntries: match.recentEntries,
        recentExits: match.recentExits,
        score: match.score,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if known smart LP wallets are active in a given pool.
   * Takes a list of known wallet addresses and checks their portfolios.
   */
  async checkWalletsInPool(wallets: string[], poolAddress: string): Promise<{
    activeWallets: string[];
    entries24h: number;
    exits24h: number;
  }> {
    const activeWallets: string[] = [];
    let entries24h = 0;
    let exits24h = 0;

    const results = await Promise.allSettled(
      wallets.map(w => this.getPortfolio(w))
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const portfolio = result.value;
      const found = portfolio.pools.find(p =>
        p.poolAddress.toLowerCase() === poolAddress.toLowerCase()
      );
      if (found) {
        activeWallets.push(portfolio.wallet);
      }
    }

    const poolIntel = await this.getPoolIntelligence(poolAddress);
    if (poolIntel) {
      entries24h = poolIntel.recentEntries;
      exits24h = poolIntel.recentExits;
    }

    return { activeWallets, entries24h, exits24h };
  }

  async getTrendingPools(): Promise<Array<{
    poolAddress: string;
    name: string;
    baseMint: string;
    quoteMint: string;
    tvl: number;
    volume24h: number;
    smartWalletCount: number;
  }>> {
    try {
      const pools = await this.getPoolScores();
      return pools
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map(p => ({
          poolAddress: p.poolAddress,
          name: p.poolAddress.slice(0, 8),
          baseMint: '',
          quoteMint: '',
          tvl: 0,
          volume24h: 0,
          smartWalletCount: p.smartWalletCount,
        }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pools = await this.getPoolScores();
      return Array.isArray(pools);
    } catch {
      return false;
    }
  }
}
