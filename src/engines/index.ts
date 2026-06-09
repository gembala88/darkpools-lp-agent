import { TxMomentumEngine } from './txMomentumEngine.js';
import { BuySellPressureEngine } from './buySellPressureEngine.js';
import { TraderGrowthEngine } from './traderGrowthEngine.js';
import { LiquidityStabilityEngine } from './liquidityStabilityEngine.js';
import { FeeVelocityEngine } from './feeVelocityEngine.js';
import { SmartMoneyConvictionEngine } from './smartMoneyConvictionEngine.js';
import { CapitalInflowEngine } from './capitalInflowEngine.js';
import { HolderGrowthEngine } from './holderGrowthEngine.js';
import { NarrativeEngineV2 } from './narrativeEngineV2.js';
import { FeeAprPredictionEngine } from './feeAprPredictionEngine.js';
import { LiquidityUtilizationEngine } from './liquidityUtilizationEngine.js';
import { CapitalRotationEngine } from './capitalRotationEngine.js';
import { HotPoolDetector } from './hotPoolDetector.js';
import { SmartLPEngine } from './smartLPEngine.js';
import { RangeEfficiencyEngine } from './rangeEfficiencyEngine.js';
import { VolatilityEngine } from './volatilityEngine.js';
import { RiskEngineV2 } from './riskEngineV2.js';
import { LpAlphaScoreEngine } from './lpAlphaScoreEngine.js';
import { DeploymentDecisionEngine } from './deploymentDecisionEngine.js';
import { PositionSizingEngine } from './positionSizingEngine.js';
import { RebalanceEngine } from './rebalanceEngine.js';
import { LpMomentumEngine } from './lpMomentumEngine.js';

export { BaseEngine, type EngineConfig, type EngineResult } from './baseEngine.js';
export { TxMomentumEngine } from './txMomentumEngine.js';
export { BuySellPressureEngine } from './buySellPressureEngine.js';
export { TraderGrowthEngine } from './traderGrowthEngine.js';
export { LiquidityStabilityEngine } from './liquidityStabilityEngine.js';
export { FeeVelocityEngine } from './feeVelocityEngine.js';
export { SmartMoneyConvictionEngine } from './smartMoneyConvictionEngine.js';
export { CapitalInflowEngine } from './capitalInflowEngine.js';
export { HolderGrowthEngine } from './holderGrowthEngine.js';
export { NarrativeEngineV2 } from './narrativeEngineV2.js';
export { FeeAprPredictionEngine } from './feeAprPredictionEngine.js';
export { LiquidityUtilizationEngine } from './liquidityUtilizationEngine.js';
export { CapitalRotationEngine } from './capitalRotationEngine.js';
export { HotPoolDetector } from './hotPoolDetector.js';
export { SmartLPEngine } from './smartLPEngine.js';
export { RangeEfficiencyEngine } from './rangeEfficiencyEngine.js';
export { VolatilityEngine } from './volatilityEngine.js';
export { RiskEngineV2 } from './riskEngineV2.js';
export { LpAlphaScoreEngine } from './lpAlphaScoreEngine.js';
export { DeploymentDecisionEngine } from './deploymentDecisionEngine.js';
export { PositionSizingEngine } from './positionSizingEngine.js';
export { RebalanceEngine } from './rebalanceEngine.js';
export { LpMomentumEngine } from './lpMomentumEngine.js';
export type { DeploymentDecision } from './deploymentDecisionEngine.js';
export type { RebalanceAction } from './rebalanceEngine.js';
export type { VolatilityCategory } from './volatilityEngine.js';

export const engines = {
  txMomentum: new TxMomentumEngine(),
  buySellPressure: new BuySellPressureEngine(),
  traderGrowth: new TraderGrowthEngine(),
  liquidityStability: new LiquidityStabilityEngine(),
  feeVelocity: new FeeVelocityEngine(),
  smartMoney: new SmartMoneyConvictionEngine(),
  capitalInflow: new CapitalInflowEngine(),
  holderGrowth: new HolderGrowthEngine(),
  narrative: new NarrativeEngineV2(),
  feeAprPrediction: new FeeAprPredictionEngine(),
  liquidityUtilization: new LiquidityUtilizationEngine(),
  capitalRotation: new CapitalRotationEngine(),
  hotPool: new HotPoolDetector(),
  smartLP: new SmartLPEngine(),
  rangeEfficiency: new RangeEfficiencyEngine(),
  volatility: new VolatilityEngine(),
  risk: new RiskEngineV2(),
  lpAlphaScore: new LpAlphaScoreEngine(),
  deploymentDecision: new DeploymentDecisionEngine(),
  positionSizing: new PositionSizingEngine(),
  rebalance: new RebalanceEngine(),
  lpMomentum: new LpMomentumEngine(),
} as const;

export type Engines = typeof engines;
