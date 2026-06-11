import { BaseEngine, EngineResult } from './baseEngine.js';
import { repositories } from '../repositories/index.js';

export type BundlerRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FakeVolumeRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ScamResult {
  bundlerRisk: BundlerRisk;
  bundlerScore: number;
  concentrationRisk: number;
  top1Pct: number;
  top3Pct: number;
  devHoldingPct: number;
  liquidityAgeRisk: 'SAFE' | 'CAUTION' | 'SUSPICIOUS';
  liquidityAgeHours: number;
  fakeVolumeRisk: FakeVolumeRisk;
  fakeVolumeScore: number;
  rugProbability: number;
}

export class ScamDetectionEngine extends BaseEngine {
  readonly name = 'scam_detection';
  readonly version = '1.0.0';

  async evaluate(params?: {
    poolAddress?: string;
    tokenMint?: string;
    tokenAgeHours?: number;
    marketCap?: number;
  }): Promise<EngineResult> {
    const { poolAddress, tokenMint, tokenAgeHours = 0, marketCap = 0 } = params ?? {};
    if (!tokenMint) {
      return {
        score: 50, signal: 'neutral', reason: 'No token mint, returning neutral scam score', metadata: {
          bundlerRisk: 'LOW', bundlerScore: 0, concentrationRisk: 0, top1Pct: 0, top3Pct: 0,
          devHoldingPct: 0, liquidityAgeRisk: 'SAFE', liquidityAgeHours: 0,
          fakeVolumeRisk: 'LOW', fakeVolumeScore: 0, rugProbability: 0,
        },
      };
    }

    const bundlerResult = await this.detectBundlerBots(tokenMint, poolAddress);
    const concentrationResult = await this.checkWalletConcentration(tokenMint);
    const liquidityAgeResult = await this.checkLiquidityAge(poolAddress);
    const fakeVolumeResult = await this.detectFakeVolume(poolAddress, tokenMint);

    const rugProbability = this.calculateRugProbability(
      bundlerResult.score,
      concentrationResult.score,
      liquidityAgeResult.score,
      fakeVolumeResult.score,
      tokenAgeHours,
    );

    const bundlerRisk: BundlerRisk = bundlerResult.score >= 0.7 ? 'CRITICAL' : bundlerResult.score >= 0.4 ? 'HIGH' : bundlerResult.score >= 0.2 ? 'MEDIUM' : 'LOW';

    const metadata: Record<string, unknown> = {
      bundlerRisk,
      bundlerScore: bundlerResult.score,
      bundlerReason: bundlerResult.reason,
      concentrationRisk: concentrationResult.score,
      top1Pct: concentrationResult.top1Pct,
      top3Pct: concentrationResult.top3Pct,
      devHoldingPct: concentrationResult.devPct,
      liquidityAgeRisk: liquidityAgeResult.risk,
      liquidityAgeHours: liquidityAgeResult.hours,
      fakeVolumeRisk: fakeVolumeResult.risk,
      fakeVolumeScore: fakeVolumeResult.score,
      rugProbability,
    };

    const score = this.normalizeScore(100 - rugProbability);
    const signal = rugProbability >= 60 ? 'bearish' : rugProbability >= 30 ? 'neutral' : 'bullish';
    const reason = `rugProb=${rugProbability}%, bundler=${bundlerRisk}, concentration=${concentrationResult.score.toFixed(0)}%, liqAge=${liquidityAgeResult.risk}, fakeVol=${fakeVolumeResult.risk}`;

    return { score, signal, reason, metadata };
  }

  private async detectBundlerBots(tokenMint: string, poolAddress?: string): Promise<{ score: number; reason: string }> {
    if (!poolAddress) return { score: 0, reason: 'no pool address' };
    const recent = await repositories.transaction.getRecent(poolAddress, 1);
    if (recent.length < 3) return { score: 0, reason: `only ${recent.length} txs in last 1m` };

    const windows = this.groupByWindow(recent, 30);
    let maxClusterScore = 0;
    let worstWindow = '';

    for (const [windowKey, txs] of Object.entries(windows)) {
      const buys = txs.filter(t => t.type === 'buy');
      if (buys.length <= 5) continue;

      const uniqueWallets = new Set(buys.map(t => t.walletAddress));
      if (uniqueWallets.size <= 5) continue;

      const amounts = buys.map(t => t.amount).filter(a => a > 0);
      if (amounts.length < 3) continue;

      const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const deviations = amounts.map(a => Math.abs(a - avg) / avg);
      const meanDev = deviations.reduce((s, d) => s + d, 0) / deviations.length;

      if (meanDev < 0.3) {
        const clusterScore = Math.min(1, (buys.length / 20) * (uniqueWallets.size / 10));
        if (clusterScore > maxClusterScore) {
          maxClusterScore = clusterScore;
          worstWindow = `${buys.length} buys, ${uniqueWallets.size} wallets, dev=${(meanDev * 100).toFixed(0)}%`;
        }
      }
    }

    return { score: maxClusterScore, reason: maxClusterScore > 0 ? worstWindow : 'no bundler patterns detected' };
  }

  private groupByWindow(txs: { type: string; walletAddress: string; amount: number; timestamp: Date }[], seconds: number): Record<string, typeof txs> {
    const windows: Record<string, typeof txs> = {};
    for (const tx of txs) {
      const key = Math.floor(tx.timestamp.getTime() / (seconds * 1000)).toString();
      if (!windows[key]) windows[key] = [];
      windows[key].push(tx);
    }
    return windows;
  }

  private async checkWalletConcentration(tokenMint: string): Promise<{ score: number; top1Pct: number; top3Pct: number; devPct: number }> {
    const holders = await repositories.holder.getByToken(tokenMint);
    if (holders.length === 0) return { score: 0, top1Pct: 0, top3Pct: 0, devPct: 0 };

    const sorted = [...holders].sort((a, b) => b.balance - a.balance);
    const totalSupply = sorted.reduce((s, h) => s + h.balance, 0);

    const top1 = sorted[0];
    const top1Pct = totalSupply > 0 ? (top1.balance / totalSupply) * 100 : top1.percentage;
    const top3Pct = sorted.slice(0, 3).reduce((s, h) => s + (totalSupply > 0 ? (h.balance / totalSupply) * 100 : h.percentage), 0);

    const sortedByFirstSeen = [...holders].sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime());
    const devWallet = sortedByFirstSeen[0];
    const devPct = devWallet && totalSupply > 0 ? (devWallet.balance / totalSupply) * 100 : 0;

    let score = 0;
    if (top1Pct > 20) score = Math.min(100, score + 40);
    else if (top1Pct > 10) score += 20;
    if (top3Pct > 40) score = Math.min(100, score + 40);
    else if (top3Pct > 25) score += 20;
    if (devPct > 10) score = Math.min(100, score + 20);

    return { score, top1Pct: Math.round(top1Pct * 10) / 10, top3Pct: Math.round(top3Pct * 10) / 10, devPct: Math.round(devPct * 10) / 10 };
  }

  private async checkLiquidityAge(poolAddress?: string): Promise<{ score: number; risk: 'SAFE' | 'CAUTION' | 'SUSPICIOUS'; hours: number }> {
    if (!poolAddress) return { score: 0, risk: 'SAFE', hours: 0 };

    const latest = await repositories.liquidity.getLatest(poolAddress);
    if (!latest) return { score: 0, risk: 'SAFE', hours: 0 };

    const hours = (Date.now() - latest.timestamp.getTime()) / 3600_000;

    if (hours < 1) return { score: 70, risk: 'SUSPICIOUS', hours: Math.round(hours * 100) / 100 };
    if (hours < 24) return { score: 30, risk: 'CAUTION', hours: Math.round(hours * 100) / 100 };
    return { score: 0, risk: 'SAFE', hours: Math.round(hours * 100) / 100 };
  }

  private async detectFakeVolume(poolAddress?: string, tokenMint?: string): Promise<{ score: number; risk: FakeVolumeRisk }> {
    if (!poolAddress) return { score: 0, risk: 'LOW' };

    const txs1h = await repositories.transaction.getRecent(poolAddress, 60);
    if (txs1h.length < 5) return { score: 0, risk: 'LOW' };

    let score = 0;

    const { buys, sells } = repositories.transaction.getBuySellCount(poolAddress, 60);
    const total = buys + sells;
    if (total > 0) {
      const ratio = buys / sells;
      if (Math.abs(ratio - 1) < 0.05) score += 30;

      const idealRatio = Math.abs(1 - ratio);
      if (idealRatio < 0.02) score += 20;
    }

    const uniqueTraders = repositories.transaction.getUniqueTraders(poolAddress, 60);
    if (uniqueTraders < 5 && txs1h.length > 20) score += 25;
    else if (uniqueTraders < 10 && txs1h.length > 50) score += 15;

    const walletTxCount = new Map<string, number>();
    for (const tx of txs1h) {
      walletTxCount.set(tx.walletAddress, (walletTxCount.get(tx.walletAddress) ?? 0) + 1);
    }
    const repeating = Array.from(walletTxCount.values()).filter(c => c > 1).length;
    if (repeating > 3) score += 20;
    else if (repeating > 1) score += 10;

    const risk: FakeVolumeRisk = score >= 60 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
    return { score: Math.min(score, 100), risk };
  }

  private calculateRugProbability(
    bundlerScore: number,
    concentrationScore: number,
    liquidityAgeScore: number,
    fakeVolumeScore: number,
    tokenAgeHours: number,
  ): number {
    let prob = 0;
    prob += bundlerScore * 25;
    prob += concentrationScore * 0.25;
    prob += liquidityAgeScore * 0.15;
    prob += fakeVolumeScore * 0.2;
    if (tokenAgeHours < 2) prob += 10;
    else if (tokenAgeHours < 24) prob += 5;
    return Math.min(Math.round(prob), 100);
  }
}
