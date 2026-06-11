import { MarketDataService } from './marketDataService.js';
import { LpAlphaScoreEngine } from '../engines/lpAlphaScoreEngine.js';
import { DeploymentDecisionEngine, DeploymentDecision } from '../engines/deploymentDecisionEngine.js';
import { PositionSizingEngine } from '../engines/positionSizingEngine.js';
import { NoDeployFilterV2, FilterCriteria } from '../filters/noDeployFilterV2.js';
import { Logger } from '../logging/logger.js';
import { TelemetryService } from '../telemetry/telemetryService.js';
import { engines } from '../engines/index.js';
import { CandleIntelligenceEngine } from '../engines/candleIntelligenceEngine.js';
import { MarketPsychologyEngine } from '../engines/marketPsychologyEngine.js';
import { DeploymentMemoryEngine } from '../engines/deploymentMemoryEngine.js';
import { aiEngines } from '../ai/index.js';
import type { AIWeights } from '../ai/dynamicWeightEngine.js';

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
  aiMarketRegime?: string;
  aiPoolActivity?: string;
  aiAccumulationScore?: number;
  aiWhaleExitProbability?: number;
  aiSmartMoneyFlowScore?: number;
  aiCandlePattern?: string;
  aiMarketPsychology?: string;
  aiOverallScore?: number;
  aiConfidence?: number;
  aiChiefRecommendation?: string;
  aiChiefWarnings?: string[];
  candleIntelligenceScore?: number;
  marketPsychologyScore?: number;
  deploymentMemoryScore?: number;
  candleTrend?: string;
}

export class LPIntelligenceService {
  private marketData: MarketDataService;
  private alphaEngine: LpAlphaScoreEngine;
  private decisionEngine: DeploymentDecisionEngine;
  private sizingEngine: PositionSizingEngine;
  private noDeployFilter: NoDeployFilterV2;
  private logger: Logger;
  private telemetry: TelemetryService;

  private candleEngine: CandleIntelligenceEngine;
  private psychEngine: MarketPsychologyEngine;
  private deployMemEngine: DeploymentMemoryEngine;

  constructor() {
    this.marketData = new MarketDataService();
    this.alphaEngine = new LpAlphaScoreEngine();
    this.decisionEngine = new DeploymentDecisionEngine();
    this.sizingEngine = new PositionSizingEngine();
    this.noDeployFilter = new NoDeployFilterV2();
    this.candleEngine = new CandleIntelligenceEngine();
    this.psychEngine = new MarketPsychologyEngine();
    this.deployMemEngine = engines.deploymentMemory as DeploymentMemoryEngine;
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
      const fullSyncResult = await this.marketData.fullSync(tokenMint, poolAddress);
      const dataAvailable = new Set<string>();
      if (fullSyncResult.holders > 0) dataAvailable.add('holders');
      if (fullSyncResult.transactions > 0) dataAvailable.add('transactions');
      if (fullSyncResult.liquidity) dataAvailable.add('liquidity');
      if (fullSyncResult.market) dataAvailable.add('market_data');

      const candleResult = await this.candleEngine.evaluate({
        poolAddress, tokenMint, priceChanges: options?.priceChanges,
      });
      const opPsychResult = await this.psychEngine.evaluate({
        poolAddress, tokenMint, priceChanges: options?.priceChanges,
      });
      const candleScore = candleResult.score;
      const psychScore = opPsychResult.score;
      const trendState = (candleResult.metadata as any).trendState ?? 'NEUTRAL';
      const psychology = (opPsychResult.metadata as any).psychology ?? 'NEUTRAL';

      const regime = (await aiEngines.marketRegime.evaluate({ poolAddress, tokenMint }).catch(() => ({ metadata: { regime: 'RANGING' } }))).metadata?.regime as string ?? 'RANGING';

      // Get dynamic weights for lpAlphaScore sub-engines based on market regime
      const dynWeightResult = await engines.dynamicWeight.evaluate({ marketRegime: regime as any, confidence: 80 });
      const engineWeights = (dynWeightResult.metadata?.weights) as any;

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
        dynamicWeights: engineWeights,
      });

      const meta = alphaResult.metadata;
      const componentScores = (meta.componentScores ?? meta) as Record<string, number>;
      let lpAlphaScore = alphaResult.score;
      const confidence = Number(meta.confidence ?? 80);

      // Apply deployment memory adjustment
      const deployMemResult = await this.deployMemEngine.evaluate({
        poolAddress, currentScore: lpAlphaScore, marketRegime: regime as any, tokenMint,
      });
      lpAlphaScore = deployMemResult.score;

      const aiResults = await Promise.allSettled([
        aiEngines.poolActivity.evaluate({ poolAddress, tokenMint: tokenMint, ...options }).then(r => ({ engine: 'poolActivity', ...r })),
        aiEngines.accumulation.evaluate({ poolAddress, tokenMint: tokenMint, ...options }).then(r => ({ engine: 'accumulation', ...r })),
        aiEngines.whaleExit.evaluate({ poolAddress, tokenMint: tokenMint, ...options }).then(r => ({ engine: 'whaleExit', ...r })),
        aiEngines.smartMoneyFlow.evaluate({ poolAddress, tokenMint: tokenMint, ...options }).then(r => ({ engine: 'smartMoneyFlow', ...r })),
        aiEngines.candleIntelligence.evaluate({ poolAddress, tokenMint: tokenMint, ...options }).then(r => ({ engine: 'candleIntelligence', ...r })),
        aiEngines.marketPsychology.evaluate({ poolAddress, tokenMint: tokenMint, ...options }).then(r => ({ engine: 'marketPsychology', ...r })),
        aiEngines.selfLearning.evaluate({ poolAddress, currentScore: lpAlphaScore, ...options }).then(r => ({ engine: 'selfLearning', ...r })),
        aiEngines.deploymentMemory.evaluate({ poolAddress, currentScore: lpAlphaScore, ...options }).then(r => ({ engine: 'deploymentMemory', ...r })),
      ]);

      const successfulAI = aiResults.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<{ engine: string; score: number; signal: string; reason: string; metadata: Record<string, unknown> }>).value);
      const activityResult = successfulAI.find(r => r.engine === 'poolActivity');
      const accumulationResult = successfulAI.find(r => r.engine === 'accumulation');
      const whaleResult = successfulAI.find(r => r.engine === 'whaleExit');
      const smFlowResult = successfulAI.find(r => r.engine === 'smartMoneyFlow');
      const aiCandleResult = successfulAI.find(r => r.engine === 'candleIntelligence');
      const psychResult = successfulAI.find(r => r.engine === 'marketPsychology');
      const selfLearnResult = successfulAI.find(r => r.engine === 'selfLearning');
      const aiDeployMemResult = successfulAI.find(r => r.engine === 'deploymentMemory');

      const dynamicWeights = await aiEngines.dynamicWeight.evaluate({ marketRegime: regime, confidence });

      const analystResult = await aiEngines.analyst.evaluate({
        engineResults: successfulAI.map(r => ({ engine: r.engine, score: r.score, signal: r.signal, reason: r.reason, metadata: r.metadata })),
        weights: (dynamicWeights.metadata?.weights as AIWeights),
      });

      const agentResult = await aiEngines.multiAgent.evaluate({
        engineResults: successfulAI.map(r => ({ engine: r.engine, score: r.score, signal: r.signal, reason: r.reason })),
      });

      const chiefResult = await aiEngines.chiefAI.evaluate({
        analystResult: { overallScore: analystResult.score, confidence: (analystResult.metadata?.confidence as number), weightedScore: (analystResult.metadata?.weightedScore as number), consensusSignal: (analystResult.metadata?.consensusSignal as string) },
        agentResult: { score: agentResult.score, metadata: agentResult.metadata },
        marketRegimeScore: deployMemResult?.score ?? 50,
        poolActivityScore: activityResult?.score ?? 50,
        whaleExitScore: whaleResult?.score ?? 100,
        deploymentMemoryScore: aiDeployMemResult?.score ?? 50,
        selfLearningScore: selfLearnResult?.score ?? 50,
      });

      const chiefMeta = chiefResult.metadata as { recommendation?: { action?: string; warnings?: string[] }; warnings?: string[] };
      const aiWarnings = (chiefMeta?.recommendation?.warnings ?? chiefMeta?.warnings ?? []) as string[];
      const chiefAction = (chiefMeta?.recommendation?.action ?? 'WATCHLIST') as string;

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
        dataAvailable,
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
        marketRegime: regime as any,
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
        aiMarketRegime: regime,
        aiPoolActivity: activityResult?.metadata?.activityLevel as string ?? 'UNKNOWN',
        aiAccumulationScore: accumulationResult?.score,
        aiWhaleExitProbability: whaleResult ? (100 - whaleResult.score) : undefined,
        aiSmartMoneyFlowScore: smFlowResult?.score,
        aiCandlePattern: aiCandleResult?.metadata?.pattern as string ?? trendState,
        aiMarketPsychology: psychResult?.metadata?.psychology as string ?? psychology,
        aiOverallScore: analystResult.score,
        aiConfidence: (analystResult.metadata?.confidence as number) ?? 50,
        aiChiefRecommendation: chiefAction,
        aiChiefWarnings: aiWarnings,
        candleIntelligenceScore: candleScore,
        marketPsychologyScore: psychScore,
        deploymentMemoryScore: deployMemResult.score,
        candleTrend: trendState,
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
