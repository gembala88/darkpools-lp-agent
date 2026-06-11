import { BaseEngine, EngineResult } from './baseEngine.js';
import * as fs from 'fs';
import * as path from 'path';

interface LPWallet {
  address: string;
  poolsDeployed: number;
  totalVolume: number;
  avgFeeEarned: number;
  avgHoldingPeriod: number;
  successRate: number;
  lastActive: Date;
}

const DATA_DIR = 'data';
const DATA_FILE = 'smart-lp-wallets.json';

function getDataPath(): string {
  return path.join(process.cwd(), DATA_DIR, DATA_FILE);
}

const KNOWN_LP_WALLETS: string[] = [];

export class SmartLPEngine extends BaseEngine {
  readonly name = 'smart_lp';
  readonly version = '1.0.0';

  private trackedWallets: LPWallet[] = [];
  private knownSuccessfulWallets = new Set<string>();

  constructor() {
    super();
    this.loadWallets();
  }

  private loadWallets(): void {
    try {
      const filePath = getDataPath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data.wallets)) {
          this.trackedWallets = data.wallets as LPWallet[];
          for (const w of data.wallets as LPWallet[]) {
            if (w.successRate > 0.6) this.knownSuccessfulWallets.add(w.address);
          }
        }
      }
    } catch { /* silent */ }
  }

  private persistWallets(): void {
    try {
      const dir = path.join(process.cwd(), DATA_DIR);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        getDataPath(),
        JSON.stringify({ wallets: this.trackedWallets }, null, 2)
      );
    } catch { /* silent */ }
  }

  async evaluate(params?: { poolAddress?: string; activeLPs?: string[] }): Promise<EngineResult> {
    const { poolAddress, activeLPs = [] } = params ?? {};
    const metadata: Record<string, unknown> = {};

    // Cross-reference with HawkFi if pool address provided
    let hawkfiWallets: string[] = [];
    let hawkfiScore: number | null = null;
    if (poolAddress) {
      try {
        const { integrations } = await import('../integrations/index.js');
        const hawkfi = integrations.hawkfi;
        const intel = await hawkfi.getPoolIntelligence(poolAddress);
        if (intel) {
          hawkfiScore = intel.score;
          // If HawkFi reports wallet count, use it to boost score
          if (intel.walletCount >= 2) hawkfiWallets = [`hawkfi:${intel.walletCount}w`];
        }
      } catch { /* hawkfi unavailable */ }
    }

    const matchingWallets = this.trackedWallets.filter(w =>
      activeLPs.includes(w.address)
    );

    // Combine tracked wallets with HawkFi signal
    const totalSmartWallets = matchingWallets.length + (hawkfiWallets.length > 0 ? 1 : 0);

    metadata.matchingSmartLPs = matchingWallets.length;
    metadata.totalTrackedLPs = this.trackedWallets.length;
    metadata.hawkfiWalletCount = hawkfiWallets.length > 0 ? parseInt(hawkfiWallets[0].split(':')[1]) : 0;
    metadata.hawkfiScore = hawkfiScore;

    // HawkFi score contribution (Phase 93)
    let hawkFiBonus = 0;
    const hwCount = metadata.hawkfiWalletCount as number;
    if (hwCount >= 2) {
      hawkFiBonus = 30;
    } else if (hwCount === 1) {
      hawkFiBonus = 15;
    }

    if (matchingWallets.length === 0 && hawkFiBonus === 0) {
      return { score: 0, signal: 'neutral', reason: 'No smart LP wallets detected on this pool', metadata };
    }

    const avgSuccessRate = matchingWallets.length > 0
      ? matchingWallets.reduce((s, w) => s + w.successRate, 0) / matchingWallets.length
      : 0;
    const avgFeeEarned = matchingWallets.length > 0
      ? matchingWallets.reduce((s, w) => s + w.avgFeeEarned, 0) / matchingWallets.length
      : 0;

    metadata.avgSuccessRate = avgSuccessRate;
    metadata.avgFeeEarned = avgFeeEarned;

    const walletScore = Math.min(totalSmartWallets * 15, 30);
    const successScore = avgSuccessRate * 30;
    const feeScore = Math.min(avgFeeEarned * 10, 20);
    const recentActivity = matchingWallets.filter(w =>
      Date.now() - w.lastActive.getTime() < 7 * 24 * 3600 * 1000
    ).length;
    const activityScore = Math.min((recentActivity / (matchingWallets.length || 1)) * 20, 20);

    const score = this.normalizeScore(walletScore + successScore + feeScore + activityScore + hawkFiBonus);

    return {
      score,
      signal: this.getSignal(score),
      reason: `smartLPs=${totalSmartWallets}${hawkFiBonus > 0 ? `, hawkFi=${hwCount}w` : ''}, avgSuccess=${(avgSuccessRate * 100).toFixed(1)}%`,
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
    this.persistWallets();
  }

  isSuccessfulWallet(address: string): boolean {
    return this.knownSuccessfulWallets.has(address);
  }

  getTopLPs(limit = 10): LPWallet[] {
    return [...this.trackedWallets]
      .sort((a, b) => (b.successRate * b.totalVolume) - (a.successRate * a.totalVolume))
      .slice(0, limit);
  }

  /**
   * Update wallet performance after a deployment outcome (Phase 93).
   */
  recordOutcome(walletAddress: string, poolAddress: string, feesEarned: number, success: boolean): void {
    const existing = this.trackedWallets.findIndex(w => w.address === walletAddress);
    if (existing >= 0) {
      const w = this.trackedWallets[existing];
      w.poolsDeployed += 1;
      w.totalVolume += feesEarned;
      w.avgFeeEarned = w.totalVolume / w.poolsDeployed;
      w.lastActive = new Date();
      const totalOutcomes = w.poolsDeployed;
      const successes = success ? (w.successRate * (totalOutcomes - 1) + 1) / totalOutcomes : (w.successRate * (totalOutcomes - 1)) / totalOutcomes;
      w.successRate = Math.min(1, successes);
    } else {
      this.trackedWallets.push({
        address: walletAddress,
        poolsDeployed: 1,
        totalVolume: feesEarned,
        avgFeeEarned: feesEarned,
        avgHoldingPeriod: 0,
        successRate: success ? 1 : 0,
        lastActive: new Date(),
      });
    }
    const updated = this.trackedWallets.find(w => w.address === walletAddress);
    if (updated && updated.successRate > 0.6) {
      this.knownSuccessfulWallets.add(walletAddress);
    }
    this.persistWallets();
  }
}
