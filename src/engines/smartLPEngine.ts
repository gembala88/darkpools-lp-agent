import { BaseEngine, EngineResult } from './baseEngine.js';

interface LPWallet {
  address: string;
  poolsDeployed: number;
  totalVolume: number;
  avgFeeEarned: number;
  avgHoldingPeriod: number;
  successRate: number;
  lastActive: Date;
}

export class SmartLPEngine extends BaseEngine {
  readonly name = 'smart_lp';
  readonly version = '1.0.0';

  private trackedWallets: LPWallet[] = [];
  private knownSuccessfulWallets = new Set<string>();

  async evaluate(params?: { poolAddress?: string; activeLPs?: string[] }): Promise<EngineResult> {
    const { poolAddress, activeLPs = [] } = params ?? {};
    const metadata: Record<string, unknown> = {};

    const matchingWallets = this.trackedWallets.filter(w =>
      activeLPs.includes(w.address)
    );

    metadata.matchingSmartLPs = matchingWallets.length;
    metadata.totalTrackedLPs = this.trackedWallets.length;

    if (matchingWallets.length === 0) {
      return { score: 0, signal: 'neutral', reason: 'No smart LP wallets detected on this pool', metadata };
    }

    const avgSuccessRate = matchingWallets.reduce((s, w) => s + w.successRate, 0) / matchingWallets.length;
    const avgFeeEarned = matchingWallets.reduce((s, w) => s + w.avgFeeEarned, 0) / matchingWallets.length;

    metadata.avgSuccessRate = avgSuccessRate;
    metadata.avgFeeEarned = avgFeeEarned;

    const walletScore = Math.min(matchingWallets.length * 15, 30);
    const successScore = avgSuccessRate * 30;
    const feeScore = Math.min(avgFeeEarned * 10, 20);
    const recentActivity = matchingWallets.filter(w =>
      Date.now() - w.lastActive.getTime() < 7 * 24 * 3600 * 1000
    ).length;
    const activityScore = Math.min((recentActivity / matchingWallets.length) * 20, 20);

    const score = this.normalizeScore(walletScore + successScore + feeScore + activityScore);

    return {
      score,
      signal: this.getSignal(score),
      reason: `smartLPs=${matchingWallets.length}, avgSuccess=${(avgSuccessRate * 100).toFixed(1)}%`,
      metadata,
    };
  }

  trackWallet(wallet: LPWallet): void {
    const existing = this.trackedWallets.findIndex(w => w.address === wallet.address);
    if (existing >= 0) {
      this.trackedWallets[existing] = wallet;
    } else {
      this.trackedWallets.push(wallet);
    }
    if (wallet.successRate > 0.6) {
      this.knownSuccessfulWallets.add(wallet.address);
    }
  }

  isSuccessfulWallet(address: string): boolean {
    return this.knownSuccessfulWallets.has(address);
  }

  getTopLPs(limit = 10): LPWallet[] {
    return [...this.trackedWallets]
      .sort((a, b) => (b.successRate * b.totalVolume) - (a.successRate * a.totalVolume))
      .slice(0, limit);
  }
}
