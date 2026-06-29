import { DeploymentDecision } from '../engines/deploymentDecisionEngine.js';

export interface FilterCriteria {
  lpAlphaScore: number;
  confidence: number;
  txMomentumScore: number;
  feeVelocityScore: number;
  holderGrowthScore: number;
  liquidityStabilityScore: number;
  smartMoneyScore: number;
  buySellScore: number;
  bundlerScore: number;
  liquiditySuspicious: boolean;
  tokenAgeHours: number;
  marketCap: number;
  /** Set of data source names that had successful fetches (e.g. 'holders', 'transactions', 'liquidity') */
  dataAvailable?: Set<string>;
  /** Phase 85 — Anti-Scam & Rug Detection */
  rugProbability?: number;
  bundlerRisk?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  concentrationRisk?: number;
  /** When true, relax certain thresholds (e.g. concentration) for DRY RUN learning */
  isDryRun?: boolean;
  /** Override concentration threshold from user-config (defaults to 80 live, 95 dry-run) */
  concentrationThreshold?: number;
  /** Total buys+sells in last 60min (preferred stable window for LP activity) */
  txActivity1h?: number;
  /** Total buys+sells in last 5min (fallback) */
  txActivity5m?: number;
  /** Percentage of transactions that are sells over 1h (for extreme dump detection) */
  sellPct1h?: number;
}

export interface FilterResult {
  passed: boolean;
  decision: DeploymentDecision;
  rejectReasons: string[];
  warnings: string[];
}

export class NoDeployFilterV2 {
  private thresholds = {
    minLpAlphaScore: 70,
    minConfidence: 75,
    minTokenAgeHours: 2,
    minMarketCap: 100000,
  };

  setMinLpAlphaScore(value: number): void {
    this.thresholds.minLpAlphaScore = value;
  }

  resetMinLpAlphaScore(): void {
    this.thresholds.minLpAlphaScore = 70;
  }

  evaluate(criteria: FilterCriteria): FilterResult {
    const rejectReasons: string[] = [];
    const warnings: string[] = [];
    const da = criteria.dataAvailable ?? new Set();

    if (criteria.lpAlphaScore < this.thresholds.minLpAlphaScore) {
      rejectReasons.push(`lpAlphaScore ${criteria.lpAlphaScore} < ${this.thresholds.minLpAlphaScore}`);
    }

    if (criteria.confidence < this.thresholds.minConfidence) {
      rejectReasons.push(`confidence ${criteria.confidence} < ${this.thresholds.minConfidence}`);
    }

    if (criteria.txMomentumScore <= 0 && da.has('transactions')) {
      rejectReasons.push('negative tx momentum');
    }

    if (criteria.feeVelocityScore <= 0 && da.has('fee_data')) {
      rejectReasons.push('negative fee velocity');
    }

    if (criteria.holderGrowthScore <= 0 && da.has('holders')) {
      rejectReasons.push('negative holder growth');
    }

    if (criteria.liquidityStabilityScore <= 0 && da.has('liquidity')) {
      rejectReasons.push('liquidity draining');
    }

    if (criteria.smartMoneyScore <= 0 && da.has('smart_money')) {
      rejectReasons.push('smart money exiting');
    }

    // LP tx-activity gate: total volume (buys+sells) determines fee potential
    // Prefer 1h window (stable), fall back to 5min
    const txActivity = criteria.txActivity1h ?? criteria.txActivity5m ?? 0;
    const minTxActivity = 10;
    const limitedData = !da.has('transactions');
    if (!limitedData && txActivity < minTxActivity && criteria.txActivity5m != null) {
      rejectReasons.push(`txActivity ${txActivity} < ${minTxActivity} (5min=${criteria.txActivity5m}) — insufficient LP fee volume`);
    } else if (limitedData && criteria.txActivity5m == null && criteria.buySellScore < 50) {
      warnings.push('no tx data available for LP fee assessment');
    }

    // Extreme one-directional dump detection (rug signal, not normal LP activity)
    if (criteria.sellPct1h != null && criteria.sellPct1h > 95 && txActivity >= minTxActivity) {
      rejectReasons.push(`extreme dump: ${criteria.sellPct1h.toFixed(0)}% sells over 1h (${txActivity} tx) — rug risk`);
    }

    if (criteria.bundlerScore > 0.3) {
      rejectReasons.push(`bundler detected (${(criteria.bundlerScore * 100).toFixed(0)}%)`);
    }

    if (criteria.liquiditySuspicious) {
      rejectReasons.push('liquidity suspicious');
    }

    if (criteria.tokenAgeHours < this.thresholds.minTokenAgeHours) {
      rejectReasons.push(`token age ${criteria.tokenAgeHours}h < ${this.thresholds.minTokenAgeHours}h`);
    }

    if (criteria.marketCap < this.thresholds.minMarketCap) {
      rejectReasons.push(`market cap $${criteria.marketCap} < $${this.thresholds.minMarketCap}`);
    }

    if (criteria.liquidityStabilityScore < 40 && criteria.liquidityStabilityScore > 0 && da.has('liquidity')) {
      warnings.push('liquidity stability concerning');
    }

    if (criteria.bundlerScore > 0.1 && criteria.bundlerScore <= 0.3) {
      warnings.push('elevated bundler activity');
    }

    if (criteria.rugProbability != null && criteria.rugProbability > 60) {
      rejectReasons.push(`rugProbability ${criteria.rugProbability}% > 60%`);
    }

    if (criteria.bundlerRisk === 'CRITICAL') {
      rejectReasons.push('bundler risk CRITICAL');
    }

    const baseThreshold = criteria.concentrationThreshold ?? 80;
    const concentrationThreshold = criteria.isDryRun ? Math.min(baseThreshold + 5, 99) : baseThreshold;
    if (criteria.concentrationRisk != null && criteria.concentrationRisk > concentrationThreshold) {
      rejectReasons.push(`concentration risk ${criteria.concentrationRisk}% > ${concentrationThreshold}%${criteria.isDryRun ? ' (dry run relaxed)' : ''}`);
    }

    if (criteria.concentrationRisk != null && criteria.concentrationRisk > 50 && criteria.concentrationRisk <= concentrationThreshold) {
      warnings.push(`high concentration risk (${criteria.concentrationRisk}%)`);
    }

    const passed = rejectReasons.length === 0;
    const decision: DeploymentDecision = passed ? (warnings.length > 0 ? 'WATCHLIST' : 'SIMULATE') : 'REJECT';

    return { passed, decision, rejectReasons, warnings };
  }
}
