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

  private async fetchHolderCountFallback(mint: string): Promise<number> {
    try {
      const res = await fetch(`https://datapi.jup.ag/v1/holders/${mint}?limit=1`);
      if (!res.ok) return 0;
      const data: any = await res.json();
      const items = Array.isArray(data) ? data : (data?.holders ?? []);
      const total = data?.total ?? items.length;
      return Number(total) || 0;
    } catch {
      return 0;
    }
  }

  async fetchAndStoreTokenData(mint: string): Promise<TokenData | null> {
    try {
      const [overview, jupiterInfo] = await Promise.allSettled([
        this.birdeye.getTokenOverview(mint),
        this.jupiter.getTokenInfo(mint),
      ]);

      const birdeyeData = overview.status === 'fulfilled' ? overview.value : null;
      const jupData = jupiterInfo.status === 'fulfilled' ? jupiterInfo.value : null;

      let holders = birdeyeData?.holders ?? jupData?.holders ?? 0;
      if (holders === 0) {
        const fallback = await this.fetchHolderCountFallback(mint);
        if (fallback > 0) {
          console.log(`  [holders] ${mint.slice(0, 8)}... fallback Jupiter DatAPI count=${fallback}`);
          holders = fallback;
        }
      }

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
        holders,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const validation = repositories.token.validate(token);
      if (!validation.valid) {
        throw new Error(`Token data validation failed: ${validation.errors.join(', ')}`);
      }

      const saved = await repositories.token.upsert(token);
      console.log(`  [token] ${mint.slice(0, 8)}... ${token.symbol} mcap=${token.marketCap} liq=${token.liquidity} hldrs=${token.holders}`);
      return saved;
    } catch (error) {
      throw new Error(`Failed to fetch token data for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetchAndStoreHolders(mint: string): Promise<number> {
    try {
      const holders = await this.birdeye.getTokenHolders(mint);
      if (holders.length === 0) {
        console.log(`  [holders] ${mint.slice(0, 8)}... fetched 0 holders (empty response)`);
        return 0;
      }
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
      const saved = await repositories.holder.bulkUpsert(holderData);
      if (saved > 0) await this.saveHolderSnapshot(mint, holders.length);
      console.log(`  [holders] ${mint.slice(0, 8)}... fetched=${holders.length} mapped=${holderData.length} saved=${saved}`);
      return saved;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('429') || msg.includes('401')) {
        console.log(`  [holders] ${mint.slice(0, 8)}... Birdeye rate limited, trying Jupiter DatAPI`);
        try {
          const res = await fetch(`https://datapi.jup.ag/v1/holders/${mint}?limit=100`);
          if (!res.ok) throw new Error(`Jupiter DatAPI returned ${res.status}`);
          const data: any = await res.json();
          const items = Array.isArray(data) ? data : (data?.holders ?? []);
          if (items.length === 0) {
            console.log(`  [holders] ${mint.slice(0, 8)}... Jupiter DatAPI also returned 0 holders`);
            return 0;
          }
          const holderData: HolderData[] = items.map((item: any) => ({
            address: String(item.address ?? ''),
            tokenMint: mint,
            balance: Number(item.amount ?? item.balance ?? 0),
            percentage: Number(item.percentage ?? item.pct ?? 0),
            firstSeen: new Date(),
            lastSeen: new Date(),
            transactionCount: 0,
            tags: [],
          }));
          const saved = await repositories.holder.bulkUpsert(holderData);
          if (saved > 0) await this.saveHolderSnapshot(mint, items.length);
          console.log(`  [holders] ${mint.slice(0, 8)}... Jupiter fallback fetched=${items.length} saved=${saved}`);
          return saved;
        } catch (fallbackError) {
          console.log(`  [holders] ${mint.slice(0, 8)}... Jupiter fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
          return 0;
        }
      }
      throw new Error(`Failed to fetch holders for ${mint}: ${msg}`);
    }
  }

  private async saveHolderSnapshot(mint: string, count: number): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const snapshotPath = path.join(process.cwd(), 'data', 'holder-snapshots.json');
      let snapshots: Record<string, { count: number; timestamp: number }> = {};
      if (fs.existsSync(snapshotPath)) {
        snapshots = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      }
      snapshots[mint] = { count, timestamp: Date.now() };
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2));
    } catch { /* snapshot persistence is best-effort */ }
  }

  async fetchAndStoreTransactions(mint: string, poolAddress: string): Promise<number> {
    try {
      const txs = await this.birdeye.getTokenTransactions(mint);
      if (txs.length === 0) {
        console.log(`  [txs] ${mint.slice(0, 8)}... fetched 0 transactions (empty response)`);
        return 0;
      }
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
      const saved = await repositories.transaction.bulkAdd(txData);
      console.log(`  [txs] ${mint.slice(0, 8)}... fetched=${txs.length} mapped=${txData.length} saved=${saved}`);
      return saved;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('429') || msg.includes('401')) {
        console.log(`  [txs] ${mint.slice(0, 8)}... Birdeye rate limited, trying DexScreener`);
        try {
          const ds = await this.dexscreener.searchPairs(mint);
          const solPairs = ds.pairs?.filter((p: any) => p.chainId === 'solana') ?? [];
          if (solPairs.length === 0) {
            console.log(`  [txs] ${mint.slice(0, 8)}... DexScreener returned 0 Solana pairs`);
            return 0;
          }
          const best: any = solPairs[0];
          // DexScreener API returns txns (buy/sell objects), not txCount (number)
          // Use txns.m5.buys+sells for real tx data; fall back to txCount if unavailable
          const m5Buys = Number(best.txns?.m5?.buys ?? best.txCount?.m5 ?? 0);
          const m5Sells = Number(best.txns?.m5?.sells ?? 0);
          const h1Buys = Number(best.txns?.h1?.buys ?? best.txCount?.h1 ?? 0);
          const h1Sells = Number(best.txns?.h1?.sells ?? 0);
          let totalTx5m = m5Buys + m5Sells;
          let ratio5m = m5Sells > 0 ? m5Buys / m5Sells : totalTx5m;
          console.log(`[tx-debug] ${mint} txns.m5 buys=${m5Buys} sells=${m5Sells} total=${totalTx5m} h1 buys=${h1Buys} sells=${h1Sells}`);
          // Fallback: m5 can be 0 for low-traffic pairs — try h1, then h6
          if (totalTx5m === 0 && ((best.txns?.h1?.buys ?? best.txCount?.h1 ?? 0) > 0)) {
            const h1Total = h1Buys + h1Sells;
            totalTx5m = Math.round(h1Total / 12);
            ratio5m = h1Sells > 0 ? h1Buys / h1Sells : h1Total;
            console.log(`  [txs] ${mint.slice(0, 8)}... m5=0 using h1/${12}=${totalTx5m} tx estimate`);
          } else if (totalTx5m === 0 && (best.txns?.h6?.buys ?? 0) > 0) {
            const h6Total = Number(best.txns.h6.buys) + Number(best.txns.h6.sells ?? 0);
            totalTx5m = Math.round(h6Total / 72);
            ratio5m = Number(best.txns.h6.sells ?? 0) > 0 ? Number(best.txns.h6.buys ?? 0) / Number(best.txns.h6.sells ?? 0) : h6Total;
            console.log(`  [txs] ${mint.slice(0, 8)}... m5&h1=0 using h6/${72}=${totalTx5m} tx estimate`);
          }
          const buys5m = Math.round(totalTx5m * ratio5m / (1 + ratio5m));
          const sells5m = totalTx5m - buys5m;
          const price = Number(best.price?.usd ?? 0);
          const txData: TransactionData[] = [];
          let synthCounter = 0;
          const now = Date.now();
          let totalVol5m = Number(best.volume?.m5 ?? 0);
          // Volume fallback: m5 can be 0 — try h1/12, then h6/72
          if (totalVol5m === 0 && (best.volume?.h1 ?? 0) > 0) {
            totalVol5m = Number(best.volume.h1) / 12;
          } else if (totalVol5m === 0 && (best.volume?.h6 ?? 0) > 0) {
            totalVol5m = Number(best.volume.h6) / 72;
          }
          // Create synthetic buy records for 5m window
          const buyCount = Math.min(buys5m, 20);
          for (let i = 0; i < buyCount; i++) {
            synthCounter++;
            const sig = `synth:${poolAddress.slice(0, 6)}:${mint.slice(0, 6)}:buy:${synthCounter}`;
            txData.push({
              signature: sig,
              poolAddress,
              tokenMint: mint,
              type: 'buy',
              amount: 0,
              volumeUsd: totalVol5m / Math.max(buyCount, 1),
              price,
              walletAddress: `synth:${synthCounter}`,
              timestamp: new Date(now - i * 15000),
              isSmartMoney: false,
              uniqueKey: sig,
            });
          }
          // Create synthetic sell records for 5m window
          const sellCount = Math.min(sells5m, 10);
          for (let i = 0; i < sellCount; i++) {
            synthCounter++;
            const sig = `synth:${poolAddress.slice(0, 6)}:${mint.slice(0, 6)}:sell:${synthCounter}`;
            txData.push({
              signature: sig,
              poolAddress,
              tokenMint: mint,
              type: 'sell',
              amount: 0,
              volumeUsd: totalVol5m / Math.max(sellCount, 1) * 0.5,
              price,
              walletAddress: `synth:${synthCounter}`,
              timestamp: new Date(now - i * 15000),
              isSmartMoney: false,
              uniqueKey: sig,
            });
          }
          const saved = await repositories.transaction.bulkAdd(txData);
          console.log(`  [txs] ${mint.slice(0, 8)}... DexScreener fallback created=${txData.length} saved=${saved} (5m txs=${totalTx5m} buy=${buys5m} sell=${sells5m})`);
          return saved;
        } catch (fallbackError) {
          console.log(`  [txs] ${mint.slice(0, 8)}... DexScreener fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
          return 0;
        }
      }
      throw new Error(`Failed to fetch transactions for ${mint}: ${msg}`);
    }
  }

  async fetchAndStoreMarketData(mint: string, poolAddress: string): Promise<MarketData | null> {
    try {
      const [birdeyeMarket, pairActivity, dexPairs] = await Promise.allSettled([
        this.birdeye.getTokenMarketData(mint),
        this.dexscreener.getPairActivity(poolAddress),
        this.dexscreener.searchPairs(mint),
      ]);

      const bd = birdeyeMarket.status === 'fulfilled' ? birdeyeMarket.value : null;
      const ds = pairActivity.status === 'fulfilled' ? pairActivity.value : null;

      // DexScreener volume fallback when Birdeye is rate limited
      let dexVol5m = 0;
      let dexTx5m = 0;
      let dexVol1h = 0;
      let dexTx1h = 0;
      if (dexPairs.status === 'fulfilled' && dexPairs.value) {
        const solPairs = dexPairs.value.pairs?.filter(p => p.chainId === 'solana') ?? [];
        if (solPairs.length > 0) {
          dexVol5m = Math.max(...solPairs.map(p => p.volume?.m5 ?? 0));
          dexTx5m = Math.max(...solPairs.map(p => p.txCount?.m5 ?? 0));
          dexVol1h = Math.max(...solPairs.map(p => p.volume?.h1 ?? 0));
          dexTx1h = Math.max(...solPairs.map(p => p.txCount?.h1 ?? 0));
        }
      }

      const marketData: MarketData = {
        poolAddress,
        tokenMint: mint,
        price: bd?.price ?? 0,
        volume5m: bd?.volume5m || dexVol5m || 0,
        volume15m: bd?.volume15m || 0,
        volume30m: bd?.volume30m || 0,
        volume1h: bd?.volume1h || dexVol1h || 0,
        volume24h: bd?.volume24h || 0,
        txCount5m: bd?.txCount5m || ds?.txCount.m5 || dexTx5m || 0,
        txCount15m: bd?.txCount15m || 0,
        txCount30m: bd?.txCount30m || 0,
        txCount1h: bd?.txCount1h || ds?.txCount.h1 || dexTx1h || 0,
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
      console.log(`  [market] ${mint.slice(0, 8)}... vol5m=${marketData.volume5m} tx5m=${marketData.txCount5m}`);
      return marketData;
    } catch (error) {
      throw new Error(`Failed to fetch market data for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async syncPoolLiquidity(poolAddress: string, cachedDlmmData?: { tvl?: number; volume24h?: number; fees24h?: number; binStep?: number; activeBin?: number; tokenMint?: string; verifiedDlmm?: boolean }): Promise<LiquiditySnapshot | null> {
    if (cachedDlmmData?.verifiedDlmm && cachedDlmmData.tvl != null && cachedDlmmData.tvl > 0) {
      const tvl = cachedDlmmData.tvl;
      const snapshot: LiquiditySnapshot = {
        poolAddress,
        tokenMint: cachedDlmmData.tokenMint ?? poolAddress,
        liquidity: tvl,
        tvl,
        activeBinLiquidity: 0,
        timestamp: new Date(),
        source: 'pool-discovery',
      };
      await repositories.liquidity.add(snapshot);
      const label = poolAddress.slice(0, 8);
      console.log(`  [EVAL] ${label} using cached DLMM tvl=${tvl} (skip dead endpoint)`);
      return snapshot;
    }
    try {
      const pool = await this.meteora.getPool(poolAddress);
      if (!pool || !pool.mintX) {
        console.log(`  [liquidity] ${poolAddress.slice(0, 8)}... pool not found or invalid`);
        return null;
      }
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
      console.log(`  [liquidity] ${poolAddress.slice(0, 8)}... mint=${pool.mintX.slice(0, 8)}... liq=${snapshot.liquidity} tvl=${snapshot.tvl}`);
      return snapshot;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('404')) {
        console.log(`  [liquidity] ${poolAddress.slice(0, 8)}... pool not on Meteora (404), trying DexScreener`);
        try {
          const ds = await this.dexscreener.searchPairs(poolAddress);
          const solPair = ds.pairs?.find(p => p.chainId === 'solana');
          if (solPair) {
            const snapshot: LiquiditySnapshot = {
              poolAddress,
              tokenMint: solPair.baseToken.address,
              liquidity: solPair.liquidity?.usd ?? 0,
              tvl: solPair.liquidity?.usd ?? 0,
              activeBinLiquidity: 0,
              timestamp: new Date(),
              source: 'dexscreener',
            };
            await repositories.liquidity.add(snapshot);
            console.log(`  [liquidity] ${poolAddress.slice(0, 8)}... dex liq=${snapshot.liquidity}`);
            return snapshot;
          }
        } catch { }
        console.log(`  [liquidity] ${poolAddress.slice(0, 8)}... no DexScreener data either`);
        return null;
      }
      console.log(`  [liquidity] ${poolAddress.slice(0, 8)}... FAILED: ${msg}`);
      return null;
    }
  }

  async fullSync(mint: string, poolAddress: string, cachedDlmmData?: { tvl?: number; volume24h?: number; fees24h?: number; binStep?: number; activeBin?: number; tokenMint?: string; verifiedDlmm?: boolean }): Promise<{
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
      this.syncPoolLiquidity(poolAddress, cachedDlmmData),
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
