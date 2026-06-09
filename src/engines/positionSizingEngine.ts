import { BaseEngine, EngineResult } from './baseEngine.js';
import { DeploymentDecision } from './deploymentDecisionEngine.js';

interface SizingConfig {
  baseAllocationPct: number;
  maxAllocationPct: number;
  minAllocationPct: number;
  maxCapitalSol: number;
  minCapitalSol: number;
  riskMultiplier: number;
  confidenceMultiplier: number;
}

export class PositionSizingEngine extends BaseEngine {
  readonly name = 'position_sizing';
  readonly version = '1.0.0';

  private config_: SizingConfig = {
    baseAllocationPct: 35,
    maxAllocationPct: 60,
    minAllocationPct: 10,
    maxCapitalSol: 50,
    minCapitalSol: 0.5,
    riskMultiplier: 1.5,
    confidenceMultiplier: 1.2,
  };

  async evaluate(params?: {
    lpAlphaScore?: number;
    confidence?: number;
    deploymentDecision?: DeploymentDecision;
    availableCapital?: number;
    riskScore?: number;
  }): Promise<EngineResult> {
    const {
      lpAlphaScore = 0,
      confidence = 0,
      deploymentDecision = 'WATCHLIST',
      availableCapital = 1,
      riskScore = 50,
    } = params ?? {};

    const metadata: Record<string, unknown> = {};

    const allocationPct = this.calculateAllocationPct(
      lpAlphaScore,
      confidence,
      deploymentDecision,
      riskScore
    );

    const recommendedCapital = Math.max(
      this.config_.minCapitalSol,
      Math.min(this.config_.maxCapitalSol, availableCapital * (allocationPct / 100))
    );

    metadata.allocationPct = allocationPct;
    metadata.recommendedCapital = recommendedCapital;
    metadata.availableCapital = availableCapital;

    return {
      score: allocationPct,
      signal: allocationPct > 0 ? 'bullish' : 'neutral',
      reason: `allocation=${allocationPct.toFixed(1)}%, capital=${recommendedCapital.toFixed(2)} SOL`,
      metadata,
    };
  }

  private calculateAllocationPct(
    score: number,
    confidence: number,
    decision: DeploymentDecision,
    riskScore: number
  ): number {
    const basePct = this.config_.baseAllocationPct;
    const scoreMultiplier = score / 100;
    const confidenceMultiplier = this.config_.confidenceMultiplier * (confidence / 100);
    const riskAdjustment = riskScore > 50
      ? this.config_.riskMultiplier * ((riskScore - 50) / 50)
      : -((50 - riskScore) / 50);

    const decisionMultiplier: Record<DeploymentDecision, number> = {
      REJECT: 0,
      WATCHLIST: 0.1,
      SIMULATE: 0.25,
      DEPLOY_SMALL: 0.5,
      DEPLOY_NORMAL: 0.75,
      DEPLOY_AGGRESSIVE: 1.0,
    };

    const decisionFactor = decisionMultiplier[decision] ?? 0;
    let allocation = basePct * scoreMultiplier * (0.5 + decisionFactor * 0.5);
    allocation *= (1 + riskAdjustment * 0.1);

    return Math.max(
      decision === 'REJECT' ? 0 : this.config_.minAllocationPct,
      Math.min(this.config_.maxAllocationPct, allocation)
    );
  }

  setConfig(config: Partial<SizingConfig>): void {
    Object.assign(this.config_, config);
  }
}
