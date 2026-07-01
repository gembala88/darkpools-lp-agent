import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';
import { integrations } from '../integrations/index.js';

export class TxMomentumEngine extends BaseEngine {
  readonly name = 'tx_momentum';
  readonly version = '1.0.0';

  async evaluate(params?: { poolAddress?: string; tokenMint?: string }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress;
    const tokenMint = params?.tokenMint;
    if (!poolAddress) {
      return { score: 0, signal: 'bearish', reason: 'No pool address provided', metadata: {} };
    }

    const now = Date.now();
    const timeframes = [5, 15, 30, 60];
    const txData: Record<string, number> = {};
    const metadata: Record<string, unknown> = {};

    for (const min of timeframes) {
      const txs = await repositories.transaction.getRecent(poolAddress, min);
      const count = txs.length;
      txData[`txCount${min}m`] = count;
    }

    const repoHasData = Object.values(txData).some(v => v > 0);

    // Always try DexScreener when tokenMint is available (first-class source, not just fallback)
    if (tokenMint) {
      try {
        const ds = await integrations.dexscreener.searchPairs(tokenMint);
        const solPairs = ds?.pairs?.filter((p: any) => p.chainId === 'solana') ?? [];
        metadata.dexScreenerPairsCount = solPairs.length;
        const txnsPresent = solPairs.some((p: any) => p.txns?.m5 || p.txns?.h1);
        metadata.dexScreenerTxnsPresent = txnsPresent;

        if (solPairs.length > 0) {
          // Pick best pair by liquidity.usd descending (not solPairs[0])
          const best: any = solPairs.sort(
            (a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
          )[0];

          const m5Buy = Number(best.txns?.m5?.buys ?? best.buySellRatio?.m5 ?? 0);
          const m5Sell = Number(best.txns?.m5?.sells ?? 1);
          const h1Buy = Number(best.txns?.h1?.buys ?? best.buySellRatio?.h1 ?? 0);
          const h1Sell = Number(best.txns?.h1?.sells ?? 1);
          const m5Total = m5Buy + m5Sell > 0 ? m5Buy + m5Sell : Number(best.txCount?.m5 ?? 0);
          const h1Total = h1Buy + h1Sell > 0 ? h1Buy + h1Sell : Number(best.txCount?.h1 ?? 0);

          if (m5Total > 0) {
            txData.txCount5m = m5Total;
            metadata.source = repoHasData ? 'dexscreener+repo' : 'dexscreener';
            metadata.pairAddress = best.pairAddress ?? '';
            metadata.pairLiquidityUsd = best.liquidity?.usd ?? 0;
            metadata.m5Buys = m5Buy;
            metadata.m5Sells = m5Sell;
            metadata.h1Buys = h1Buy;
            metadata.h1Sells = h1Sell;

            const rawBest = best as any;
            const priceChangeM5 = Number(rawBest.priceChange?.m5 ?? 0);
            const priceChangeH1 = Number(rawBest.priceChange?.h1 ?? 0);
            metadata.priceChangeM5 = priceChangeM5;
            metadata.priceChangeH1 = priceChangeH1;

            const velocity = m5Total * 12;
            metadata.txVelocity = velocity;
            metadata.txAcceleration = m5Total > 0 && h1Total > 0
              ? (m5Total - h1Total / 12) / (h1Total / 12)
              : 0;
            metadata.txTrend = m5Total > 0 && h1Total > 0
              ? (m5Total > h1Total / 12 ? 'up' : m5Total < h1Total / 12 ? 'down' : 'stable')
              : 'stable';

            const baseScore = Math.min(velocity * 0.5, 50);
            const accelBonus = Math.max(0, Math.min((metadata.txAcceleration as number) * 20, 30));
            const trendBonus = metadata.txTrend === 'up' ? 20 : metadata.txTrend === 'stable' ? 10 : 0;

            const score = this.normalizeScore(baseScore + accelBonus + trendBonus);
            const reason = `[${metadata.source}] txVelocity=${velocity.toFixed(1)}/h, m5=${m5Total} buys=${m5Buy} sells=${m5Sell}, trend=${metadata.txTrend}`;
            return { score, signal: this.getSignal(score), reason, metadata };
          }
        }
      } catch (err) {
        console.warn(`[txMomentum] DexScreener fallback failed for ${tokenMint}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Fall back to repo data when DexScreener unavailable or returned empty
    if (repoHasData) {
      metadata.source = 'repo';
      metadata.dataAvailable = true;

      const velocity = (txData.txCount5m ?? 0) / 5;
      const acceleration = 0;
      const trend = 'stable';

      const baseScore = Math.min(velocity * 10, 50);
      const accelBonus = 0;
      const trendBonus = 10;

      const score = this.normalizeScore(baseScore + accelBonus + trendBonus);
      const reason = `[repo] tx velocity=${velocity.toFixed(2)}/s, count5m=${txData.txCount5m ?? 0}`;
      return { score, signal: this.getSignal(score), reason, metadata };
    }

    // No data from any source — return neutral instead of 0 (doesn't trigger hasNegativeSignal)
    metadata.dataAvailable = false;
    console.warn(`[txMomentum] No data for pool=${poolAddress} token=${tokenMint ?? 'N/A'} — returning neutral`);
    return { score: 50, signal: 'neutral', reason: 'No transaction data available from any source', metadata };
  }
}
