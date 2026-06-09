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
}

export interface FilterResult {
  passed: boolean;
  decision: DeploymentDecision;
  rejectReasons: string[];
  warnings: string[];
}

export class NoDeployFilterV2 {
  private readonly thresholds = {
    minLpAlphaScore: 70,
    minConfidence: 75,
    minBuySellRatio: 0.90,
    minTokenAgeHours: 2,
    minMarketCap: 100000,
  };

  evaluate(criteria: FilterCriteria): FilterResult {
    const rejectReasons: string[] = [];
    const warnings: string[] = [];

    if (criteria.lpAlphaScore < this.thresholds.minLpAlphaScore) {
      rejectReasons.push(`lpAlphaScore ${criteria.lpAlphaScore} < ${this.thresholds.minLpAlphaScore}`);
    }

    if (criteria.confidence < this.thresholds.minConfidence) {
      rejectReasons.push(`confidence ${criteria.confidence} < ${this.thresholds.minConfidence}`);
    }

    if (criteria.txMomentumScore <= 0) {
      rejectReasons.push('negative tx momentum');
    }

    if (criteria.feeVelocityScore <= 0) {
      rejectReasons.push('negative fee velocity');
    }

    if (criteria.holderGrowthScore <= 0) {
      rejectReasons.push('negative holder growth');
    }

    if (criteria.liquidityStabilityScore <= 0) {
      rejectReasons.push('liquidity draining');
    }

    if (criteria.smartMoneyScore <= 0) {
      rejectReasons.push('smart money exiting');
    }

    if (criteria.buySellScore < this.thresholds.minBuySellRatio * 100) {
      rejectReasons.push(`buySellRatio ${(criteria.buySellScore / 100).toFixed(2)} < ${this.thresholds.minBuySellRatio}`);
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

    if (criteria.liquidityStabilityScore < 40 && criteria.liquidityStabilityScore > 0) {
      warnings.push('liquidity stability concerning');
    }

    if (criteria.bundlerScore > 0.1 && criteria.bundlerScore <= 0.3) {
      warnings.push('elevated bundler activity');
    }

    const passed = rejectReasons.length === 0;
    const decision: DeploymentDecision = passed ? (warnings.length > 0 ? 'WATCHLIST' : 'SIMULATE') : 'REJECT';

    return { passed, decision, rejectReasons, warnings };
  }
}
