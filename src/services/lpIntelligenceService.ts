import { MarketDataService } from './marketDataService.js';
import { LpAlphaScoreEngine } from '../engines/lpAlphaScoreEngine.js';
import { DeploymentDecisionEngine, DeploymentDecision } from '../engines/deploymentDecisionEngine.js';
import { PositionSizingEngine } from '../engines/positionSizingEngine.js';
import { NoDeployFilterV2, FilterCriteria } from '../filters/noDeployFilterV2.js';
import { Logger } from '../logging/logger.js';
import { TelemetryService } from '../telemetry/telemetryService.js';
import { repositories } from '../repositories/index.js';

export interface MasterLPOutput {
  lpAlphaScore: number;
  confidence: number;
  feeAprPrediction: number;
  utilizationScore: number;
  txMomentumScore: number;
  buySellScore: number;
  traderGrowthScore: number;
  holderGrowthScore: number;
  smartMoneyScore: number;
  smartLPScore: number;
  capitalInflowScore: number;
  liquidityStabilityScore: number;
  rangeEfficiencyScore: number;
  volatilityScore: number;
  narrativeScore: number;
  riskScore: number;
  allocationPercent: number;
  recommendedCapital: number;
  deploymentDecision: DeploymentDecision;
  reasons: string[];
}

export class LPIntelligenceService {
  private marketData: MarketDataService;
  private alphaEngine: LpAlphaScoreEngine;
  private decisionEngine: DeploymentDecisionEngine;
  private sizingEngine: PositionSizingEngine;
  private noDeployFilter: NoDeployFilterV2;
  private logger: Logger;
  private telemetry: TelemetryService;

  constructor() {
    this.marketData = new MarketDataService();
    this.alphaEngine = new LpAlphaScoreEngine();
    this.decisionEngine = new DeploymentDecisionEngine();
    this.sizingEngine = new PositionSizingEngine();
    this.noDeployFilter = new NoDeployFilterV2();
    this.logger = new Logger('LPIntelligence');
    this.telemetry = new TelemetryService();
  }

  async evaluatePool(
    poolAddress: string,
    tokenMint: string,
    options?: {
      tokenName?: string;
      tokenSymbol?: string;
      narrative?: string;
      activeBin?: number;
      lowerBin?: number;
      upperBin?: number;
      binStep?: number;
      availableCapital?: number;
      activeLPs?: string[];
      priceChanges?: number[];
      marketCap?: number;
      tokenAgeHours?: number;
    }
  ): Promise<MasterLPOutput> {
    this.logger.info(`Evaluating pool ${poolAddress} (${tokenMint})`);

    const startTime = Date.now();

    try {
      await this.marketData.fullSync(tokenMint, poolAddress);

      const alphaResult = await this.alphaEngine.evaluate({
        poolAddress,
        tokenMint,
        tokenName: options?.tokenName,
        tokenSymbol: options?.tokenSymbol,
        narrative: options?.narrative,
        activeBin: options?.activeBin,
        lowerBin: options?.lowerBin,
        upperBin: options?.upperBin,
        binStep: options?.binStep,
        marketCap: options?.marketCap,
        tokenAgeHours: options?.tokenAgeHours,
        activeLPs: options?.activeLPs,
        priceChanges: options?.priceChanges,
      });

      const meta = alphaResult.metadata;
      const componentScores = (meta.componentScores ?? meta) as Record<string, number>;
      const lpAlphaScore = alphaResult.score;
      const confidence = Number(meta.confidence ?? 80);

      const filterCriteria: FilterCriteria = {
        lpAlphaScore,
        confidence,
        txMomentumScore: Number(componentScores['txMomentum'] ?? 0),
        feeVelocityScore: Number(componentScores['feeAprPrediction'] ?? 0),
        holderGrowthScore: Number(componentScores['holderGrowth'] ?? 0),
        liquidityStabilityScore: Number(componentScores['liquidityStability'] ?? 0),
        smartMoneyScore: Number(componentScores['smartMoney'] ?? 0),
        buySellScore: Number(componentScores['buySell'] ?? 0),
        bundlerScore: 0,
        liquiditySuspicious: false,
        tokenAgeHours: options?.tokenAgeHours ?? 0,
        marketCap: options?.marketCap ?? 0,
      };

      const filterResult = this.noDeployFilter.evaluate(filterCriteria);

      const finalDecision: DeploymentDecision = filterResult.passed
        ? filterResult.decision
        : 'REJECT';

      const sizingResult = await this.sizingEngine.evaluate({
        lpAlphaScore,
        confidence,
        deploymentDecision: finalDecision,
        availableCapital: options?.availableCapital,
        riskScore: componentScores['risk'] ?? 50,
      });

      const decisionResult = await this.decisionEngine.evaluate({
        lpAlphaScore,
        confidence,
        componentScores,
      });

      const endTime = Date.now();
      this.telemetry.record('pool_evaluation', endTime - startTime, {
        poolAddress,
        tokenMint,
        lpAlphaScore,
        decision: finalDecision,
      });

      this.logger.info(`Evaluation complete: score=${lpAlphaScore.toFixed(2)}, decision=${finalDecision}, time=${endTime - startTime}ms`);

      return {
        lpAlphaScore,
        confidence,
        feeAprPrediction: componentScores['feeAprPrediction'] ?? 0,
        utilizationScore: componentScores['liquidityUtilization'] ?? 0,
        txMomentumScore: componentScores['txMomentum'] ?? 0,
        buySellScore: componentScores['buySell'] ?? 0,
        traderGrowthScore: componentScores['traderGrowth'] ?? 0,
        holderGrowthScore: componentScores['holderGrowth'] ?? 0,
        smartMoneyScore: componentScores['smartMoney'] ?? 0,
        smartLPScore: componentScores['smartLP'] ?? 0,
        capitalInflowScore: componentScores['capitalInflow'] ?? 0,
        liquidityStabilityScore: componentScores['liquidityStability'] ?? 0,
        rangeEfficiencyScore: componentScores['rangeEfficiency'] ?? 0,
        volatilityScore: 0,
        narrativeScore: componentScores['narrative'] ?? 0,
        riskScore: componentScores['risk'] ?? 50,
        allocationPercent: sizingResult.score,
        recommendedCapital: (sizingResult.metadata['recommendedCapital'] as number) ?? 0,
        deploymentDecision: finalDecision,
        reasons: filterResult.rejectReasons.length > 0
          ? filterResult.rejectReasons
          : alphaResult.reason ? [alphaResult.reason] : [],
      };
    } catch (error) {
      this.logger.error(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      this.telemetry.record('evaluation_error', Date.now() - startTime, {
        poolAddress,
        tokenMint,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
