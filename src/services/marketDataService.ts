import { repositories } from '../repositories/index.js';
import { integrations } from '../integrations/index.js';
import { BirdeyeAdapter } from '../integrations/birdeye/birdeyeAdapter.js';
import { DexScreenerAdapter } from '../integrations/dexscreener/dexscreenerAdapter.js';
import { JupiterAdapter } from '../integrations/jupiter/jupiterAdapter.js';
import { MeteoraAdapter } from '../integrations/meteora/meteoraAdapter.js';
import {
  TokenData,
  HolderData,
  MarketData,
  TransactionData,
  LiquiditySnapshot,
} from '../types/index.js';

export class MarketDataService {
  private birdeye: BirdeyeAdapter;
  private dexscreener: DexScreenerAdapter;
  private jupiter: JupiterAdapter;
  private meteora: MeteoraAdapter;

  constructor() {
    this.birdeye = integrations.birdeye;
    this.dexscreener = integrations.dexscreener;
    this.jupiter = integrations.jupiter;
    this.meteora = integrations.meteora;
  }

  async fetchAndStoreTokenData(mint: string): Promise<TokenData | null> {
    try {
      const [overview, jupiterInfo] = await Promise.allSettled([
        this.birdeye.getTokenOverview(mint),
        this.jupiter.getTokenInfo(mint),
      ]);

      const birdeyeData = overview.status === 'fulfilled' ? overview.value : null;
      const jupData = jupiterInfo.status === 'fulfilled' ? jupiterInfo.value : null;

      const token: TokenData = {
        mint,
        symbol: birdeyeData?.symbol ?? jupData?.symbol ?? 'UNKNOWN',
        name: birdeyeData?.name ?? jupData?.name ?? 'Unknown',
        decimals: birdeyeData?.decimals ?? jupData?.decimals ?? 6,
        supply: 0,
        price: birdeyeData?.price ?? jupData?.price ?? 0,
        marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0,
        liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0,
        volume24h: birdeyeData?.volume24h ?? 0,
        holders: birdeyeData?.holders ?? jupData?.holders ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const validation = repositories.token.validate(token);
      if (!validation.valid) {
        throw new Error(`Token data validation failed: ${validation.errors.join(', ')}`);
      }

      return await repositories.token.upsert(token);
    } catch (error) {
      throw new Error(`Failed to fetch token data for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetchAndStoreHolders(mint: string): Promise<number> {
    try {
      const holders = await this.birdeye.getTokenHolders(mint);
      const holderData: HolderData[] = holders.map(h => ({
        address: h.address,
        tokenMint: mint,
        balance: h.balance,
        percentage: h.percentage,
        firstSeen: new Date(),
        lastSeen: new Date(),
        transactionCount: 0,
        tags: h.tags ?? [],
      }));
      return await repositories.holder.bulkUpsert(holderData);
    } catch (error) {
      throw new Error(`Failed to fetch holders for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetchAndStoreTransactions(mint: string, poolAddress: string): Promise<number> {
    try {
      const txs = await this.birdeye.getTokenTransactions(mint);
      const txData: TransactionData[] = txs.map(t => ({
        signature: t.signature,
        poolAddress,
        tokenMint: mint,
        type: t.type,
        amount: t.amount,
        volumeUsd: t.volumeUsd,
        price: t.price,
        walletAddress: t.walletAddress,
        timestamp: new Date(t.timestamp * 1000),
        isSmartMoney: false,
        uniqueKey: `${t.signature}:${t.type}`,
      }));
      return await repositories.transaction.bulkAdd(txData);
    } catch (error) {
      throw new Error(`Failed to fetch transactions for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetchAndStoreMarketData(mint: string, poolAddress: string): Promise<MarketData | null> {
    try {
      const [birdeyeMarket, pairActivity] = await Promise.allSettled([
        this.birdeye.getTokenMarketData(mint),
        this.dexscreener.getPairActivity(poolAddress),
      ]);

      const bd = birdeyeMarket.status === 'fulfilled' ? birdeyeMarket.value : null;
      const ds = pairActivity.status === 'fulfilled' ? pairActivity.value : null;

      const marketData: MarketData = {
        poolAddress,
        tokenMint: mint,
        price: bd?.price ?? 0,
        volume5m: bd?.volume5m ?? 0,
        volume15m: bd?.volume15m ?? 0,
        volume30m: bd?.volume30m ?? 0,
        volume1h: bd?.volume1h ?? 0,
        volume24h: bd?.volume24h ?? 0,
        txCount5m: bd?.txCount5m ?? ds?.txCount.m5 ?? 0,
        txCount15m: bd?.txCount15m ?? 0,
        txCount30m: bd?.txCount30m ?? 0,
        txCount1h: bd?.txCount1h ?? ds?.txCount.h1 ?? 0,
        buyVolume5m: bd?.buyVolume5m ?? 0,
        sellVolume5m: bd?.sellVolume5m ?? 0,
        buyCount5m: 0,
        sellCount5m: 0,
        uniqueTraders5m: bd?.uniqueTraders5m ?? 0,
        uniqueTraders15m: bd?.uniqueTraders15m ?? 0,
        uniqueTraders1h: bd?.uniqueTraders1h ?? 0,
        uniqueTraders4h: 0,
        timestamp: new Date(),
      };

      const validation = repositories.market.validate(marketData);
      if (!validation.valid) {
        throw new Error(`Market data validation failed: ${validation.errors.join(', ')}`);
      }

      await repositories.market.add(marketData);
      return marketData;
    } catch (error) {
      throw new Error(`Failed to fetch market data for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async syncPoolLiquidity(poolAddress: string): Promise<LiquiditySnapshot | null> {
    try {
      const pool = await this.meteora.getPool(poolAddress);
      const snapshot: LiquiditySnapshot = {
        poolAddress,
        tokenMint: pool.mintX,
        liquidity: pool.liquidityX + pool.liquidityY,
        tvl: pool.tvl,
        activeBinLiquidity: 0,
        timestamp: new Date(),
        source: 'meteora',
      };
      await repositories.liquidity.add(snapshot);
      return snapshot;
    } catch (error) {
      throw new Error(`Failed to sync liquidity for ${poolAddress}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fullSync(mint: string, poolAddress: string): Promise<{
    token: TokenData | null;
    holders: number;
    transactions: number;
    market: MarketData | null;
    liquidity: LiquiditySnapshot | null;
  }> {
    const [token, holders, transactions, market, liquidity] = await Promise.allSettled([
      this.fetchAndStoreTokenData(mint),
      this.fetchAndStoreHolders(mint),
      this.fetchAndStoreTransactions(mint, poolAddress),
      this.fetchAndStoreMarketData(mint, poolAddress),
      this.syncPoolLiquidity(poolAddress),
    ]);

    return {
      token: token.status === 'fulfilled' ? token.value : null,
      holders: holders.status === 'fulfilled' ? holders.value : 0,
      transactions: transactions.status === 'fulfilled' ? transactions.value : 0,
      market: market.status === 'fulfilled' ? market.value : null,
      liquidity: liquidity.status === 'fulfilled' ? liquidity.value : null,
    };
  }

  async getPoolMetrics(poolAddress: string, mint: string): Promise<Record<string, unknown>> {
    const [token, market, latestLiquidity] = await Promise.all([
      repositories.token.getByMint(mint),
      repositories.market.getLatest(poolAddress),
      repositories.liquidity.getLatest(poolAddress),
    ]);

    return {
      price: token?.price ?? 0,
      marketCap: token?.marketCap ?? 0,
      liquidity: latestLiquidity?.liquidity ?? 0,
      tvl: latestLiquidity?.tvl ?? 0,
      volume24h: market?.volume24h ?? 0,
      holders: token?.holders ?? 0,
      buySellRatio: repositories.market.getBuySellRatio(poolAddress),
      txVelocity: repositories.market.getTransactionVelocity(poolAddress),
      traderGrowth: repositories.market.getUniqueTraderGrowth(poolAddress),
    };
  }
}
