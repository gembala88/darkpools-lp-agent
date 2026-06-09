import { BaseIntegration } from '../baseIntegration.js';

export interface JupiterTokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  marketCap: number;
  volume24h: number;
  holders: number;
  liquidity: number;
  audit: {
    topHoldersPct: number;
    botHoldersPct: number;
    bundlerPct: number;
  };
  stats1h: {
    priceChange: number;
    volume: number;
    netBuyers: number;
  };
}

export interface JupiterRoute {
  inAmount: number;
  outAmount: number;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      feeAmount: number;
      feeMint: string;
    };
    percent: number;
  }>;
  timeTaken: number;
  totalFee: number;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  routePlan: JupiterRoute[];
  platformFee: { amount: string; feeBps: number };
}

export class JupiterAdapter extends BaseIntegration {
  readonly name = 'jupiter';

  constructor(apiKey?: string) {
    super({
      apiKey,
      baseUrl: 'https://quote-api.jup.ag/v6',
      timeout: 10000,
      maxRetries: 3,
      rateLimit: 500,
    });
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps = 50
  ): Promise<JupiterQuote> {
    return this.apiFetch<JupiterQuote>('/quote', {
      inputMint,
      outputMint,
      amount: String(amount),
      slippageBps: String(slippageBps),
    });
  }

  async getTokenInfo(mint: string): Promise<JupiterTokenInfo | null> {
    try {
      const result = await this.apiFetch<JupiterTokenInfo>(
        'https://tokens.jup.ag/token/' + mint
      );
      return result;
    } catch {
      return null;
    }
  }

  async getRoutePopularity(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<{ routes: JupiterRoute[]; popularity: number }> {
    const routes = await this.getQuote(inputMint, outputMint, amount);
    const popularity = routes.routePlan?.length ?? 0;
    return { routes: routes.routePlan ?? [], popularity };
  }

  async getTokenDemand(mint: string): Promise<{
    volume24h: number;
    uniqueSwappers: number;
    totalSwaps: number;
  }> {
    return this.apiFetch<{
      volume24h: number;
      uniqueSwappers: number;
      totalSwaps: number;
    }>('https://stats.jup.ag/volume/token/' + mint);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getQuote(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        1000000
      );
      return true;
    } catch {
      return false;
    }
  }
}
