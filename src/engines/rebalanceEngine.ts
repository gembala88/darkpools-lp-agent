import { BaseEngine, EngineResult } from './baseEngine.js';
import { TransactionData } from '../types/index.js';
import { repositories } from '../repositories/index.js';

export type RebalanceAction = 'HOLD' | 'REBALANCE' | 'EXIT' | 'EMERGENCY_EXIT';

export class RebalanceEngine extends BaseEngine {
  readonly name = 'rebalance';
  readonly version = '1.0.0';

  async evaluate(params?: {
    poolAddress?: string;
    tokenMint?: string;
    currentApr?: number;
    currentVolume?: number;
  }): Promise<EngineResult> {
    const { poolAddress, tokenMint, currentApr = 0, currentVolume = 0 } = params ?? {};
    if (!poolAddress) {
      return { score: 50, signal: 'neutral', reason: 'No pool address', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const triggers: string[] = [];
    let urgency = 0;

    const latestLiquidity = await repositories.liquidity.getLatest(poolAddress);
    if (latestLiquidity) {
      const liquidity30m = await repositories.liquidity.getAggregated(poolAddress, 30);
      if (liquidity30m.changePercent < -40) {
        triggers.push('CRITICAL_LIQUIDITY_DRAIN');
        urgency = 100;
      } else if (liquidity30m.changePercent < -20) {
        triggers.push('LIQUIDITY_DRAIN');
        urgency = Math.max(urgency, 70);
      }
    }

    const latestMarket = await repositories.market.getLatest(poolAddress);
    if (latestMarket) {
      const txTrend = await repositories.market.getVolumeTrend(poolAddress, 30);
      if (txTrend.trending === 'down' && txTrend.changePercent < -50) {
        triggers.push('TX_COLLAPSE');
        urgency = Math.max(urgency, 80);
      }
    }

    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);
    const fees1h = txs1h.reduce((s: number, t: TransactionData) => s + t.volumeUsd * 0.003, 0);
    if (fees1h < 0.01 && currentApr < 1) {
      triggers.push('FEE_COLLAPSE');
      urgency = Math.max(urgency, 60);
    }

    if (tokenMint) {
      const smartMoneyTxs = await repositories.transaction.getSmartMoneyTransactions(poolAddress, 60);
      const prevSmartMoney = await repositories.transaction.getSmartMoneyTransactions(poolAddress, 120);
      if (smartMoneyTxs.length < prevSmartMoney.length * 0.3 && prevSmartMoney.length > 5) {
        triggers.push('SMART_MONEY_EXIT');
        urgency = Math.max(urgency, 75);
      }
    }

    metadata.triggers = triggers;
    metadata.urgency = urgency;

    let action: RebalanceAction = 'HOLD';
    if (urgency >= 80) action = 'EMERGENCY_EXIT';
    else if (urgency >= 60) action = 'EXIT';
    else if (urgency >= 30) action = 'REBALANCE';

    const score = this.normalizeScore(100 - urgency);
    return {
      score,
      signal: action === 'HOLD' ? 'bullish' : 'bearish',
      reason: triggers.length > 0
        ? `Rebalance triggered: [${triggers.join(', ')}] → ${action}`
        : 'No rebalance triggers',
      metadata: { ...metadata, action },
    };
  }
}
