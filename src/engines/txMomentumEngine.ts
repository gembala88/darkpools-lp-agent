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

    // If transaction repository is empty, fall back to DexScreener
    if (txData.txCount5m === 0 && tokenMint) {
      try {
        const ds = await integrations.dexscreener.searchPairs(tokenMint);
        const solPairs = ds?.pairs?.filter((p: any) => p.chainId === 'solana') ?? [];
        if (solPairs.length > 0) {
          const best: any = solPairs[0];
          const m5Buy = Number(best.txns?.m5?.buys ?? best.buySellRatio?.m5 ?? 0);
          const m5Sell = Number(best.txns?.m5?.sells ?? 1);
          const h1Buy = Number(best.txns?.h1?.buys ?? best.buySellRatio?.h1 ?? 0);
          const h1Sell = Number(best.txns?.h1?.sells ?? 1);
          // Fallback to txCount when txns is unavailable in the interface
          const m5Total = m5Buy + m5Sell > 0 ? m5Buy + m5Sell : Number(best.txCount?.m5 ?? 0);
          const h1Total = h1Buy + h1Sell > 0 ? h1Buy + h1Sell : Number(best.txCount?.h1 ?? 0);

          txData.txCount5m = m5Total;
          metadata.dexScreenerFallback = true;
          metadata.m5Buys = m5Buy;
          metadata.m5Sells = m5Sell;
          metadata.h1Buys = h1Buy;
          metadata.h1Sells = h1Sell;

          // Price momentum from DexScreener (raw API response)
          const rawBest = best as any;
          const priceChangeM5 = Number(rawBest.priceChange?.m5 ?? 0);
          const priceChangeH1 = Number(rawBest.priceChange?.h1 ?? 0);
          metadata.priceChangeM5 = priceChangeM5;
          metadata.priceChangeH1 = priceChangeH1;

          // Tx velocity = m5_total * 12 (extrapolate to hourly)
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
          return {
            score,
            signal: this.getSignal(score),
            reason: `[DexScreener] txVelocity=${velocity.toFixed(1)}/h, m5=${m5Total} buys=${m5Buy} sells=${m5Sell}, trend=${metadata.txTrend}`,
            metadata,
          };
        }
      } catch { /* DexScreener fallback failed */ }
    }

    const velocity = (metadata.txVelocity ?? (txData.txCount5m ?? 0) / 5) as number;
    const acceleration = (metadata.txAcceleration ?? 0) as number;
    const trend = (metadata.txTrend ?? 'stable') as string;

    if (trend === 'down' && acceleration < 0) {
      return { score: 0, signal: 'bearish', reason: 'Negative tx trend detected - REJECTED', metadata };
    }

    const baseScore = Math.min(velocity * 10, 50);
    const accelBonus = Math.max(0, Math.min(acceleration * 5, 30));
    const trendBonus = trend === 'up' ? 20 : trend === 'stable' ? 10 : 0;

    const score = this.normalizeScore(baseScore + accelBonus + trendBonus);
    return { score, signal: this.getSignal(score), reason: `tx velocity=${velocity.toFixed(2)}/s, acceleration=${acceleration.toFixed(2)}`, metadata };
  }
}
