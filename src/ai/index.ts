import { MarketRegimeEngine } from './marketRegimeEngine.js';
import { PoolActivityEngine } from './poolActivityEngine.js';
import { AccumulationDetector } from './accumulationDetector.js';
import { WhaleExitProbabilityEngine } from './whaleExitProbabilityEngine.js';
import { SmartMoneyFlowEngine } from './smartMoneyFlowEngine.js';
import { AICandleIntelligenceEngine } from './aiCandleIntelligenceEngine.js';
import { MarketPsychologyEngine } from './marketPsychologyEngine.js';
import { SelfLearningEngine } from './selfLearningEngine.js';
import { DeploymentMemoryEngine } from './deploymentMemoryEngine.js';
import { DynamicWeightEngine } from './dynamicWeightEngine.js';
import { AIAnalystLayer } from './aiAnalystLayer.js';
import { MultiAgentSystem } from './multiAgentSystem.js';
import { ChiefAiDecisionSystem } from './chiefAiDecisionSystem.js';

export { MarketRegimeEngine } from './marketRegimeEngine.js';
export { PoolActivityEngine } from './poolActivityEngine.js';
export { AccumulationDetector } from './accumulationDetector.js';
export { WhaleExitProbabilityEngine } from './whaleExitProbabilityEngine.js';
export { SmartMoneyFlowEngine } from './smartMoneyFlowEngine.js';
export { AICandleIntelligenceEngine } from './aiCandleIntelligenceEngine.js';
export { MarketPsychologyEngine } from './marketPsychologyEngine.js';
export { SelfLearningEngine } from './selfLearningEngine.js';
export { DeploymentMemoryEngine } from './deploymentMemoryEngine.js';
export { DynamicWeightEngine } from './dynamicWeightEngine.js';
export { AIAnalystLayer } from './aiAnalystLayer.js';
export { MultiAgentSystem } from './multiAgentSystem.js';
export { ChiefAiDecisionSystem } from './chiefAiDecisionSystem.js';
export type { AIWeights } from './dynamicWeightEngine.js';
export type { AIAnalystResult } from './aiAnalystLayer.js';
export type { ChiefAIRecommendation } from './chiefAiDecisionSystem.js';

export const aiEngines = {
  marketRegime: new MarketRegimeEngine(),
  poolActivity: new PoolActivityEngine(),
  accumulation: new AccumulationDetector(),
  whaleExit: new WhaleExitProbabilityEngine(),
  smartMoneyFlow: new SmartMoneyFlowEngine(),
  candleIntelligence: new AICandleIntelligenceEngine(),
  marketPsychology: new MarketPsychologyEngine(),
  selfLearning: new SelfLearningEngine(),
  deploymentMemory: new DeploymentMemoryEngine(),
  dynamicWeight: new DynamicWeightEngine(),
  analyst: new AIAnalystLayer(),
  multiAgent: new MultiAgentSystem(),
  chiefAI: new ChiefAiDecisionSystem(),
} as const;

export type AIEngines = typeof aiEngines;
