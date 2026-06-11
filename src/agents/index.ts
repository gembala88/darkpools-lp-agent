import { RiskAgent } from './riskAgent.js';
import { MomentumAgent } from './momentumAgent.js';
import { WhaleAgent } from './whaleAgent.js';
import { MarketAgent } from './marketAgent.js';
import { SmartMoneyAgent } from './smartMoneyAgent.js';
import { NarrativeAgent } from './narrativeAgent.js';
import { ChiefAI } from './chiefAI.js';

export { RiskAgent } from './riskAgent.js';
export type { RiskAgentInput, RiskAgentOutput } from './riskAgent.js';
export { MomentumAgent } from './momentumAgent.js';
export type { MomentumAgentInput, MomentumAgentOutput } from './momentumAgent.js';
export { WhaleAgent } from './whaleAgent.js';
export type { WhaleAgentInput, WhaleAgentOutput } from './whaleAgent.js';
export { MarketAgent } from './marketAgent.js';
export type { MarketAgentInput, MarketAgentOutput } from './marketAgent.js';
export { SmartMoneyAgent } from './smartMoneyAgent.js';
export type { SmartMoneyAgentInput, SmartMoneyAgentOutput } from './smartMoneyAgent.js';
export { NarrativeAgent } from './narrativeAgent.js';
export type { NarrativeAgentInput, NarrativeAgentOutput } from './narrativeAgent.js';
export { ChiefAI } from './chiefAI.js';
export type { AllAgentOutputs, ChiefOutput } from './chiefAI.js';

export const agents = {
  risk: new RiskAgent(),
  momentum: new MomentumAgent(),
  whale: new WhaleAgent(),
  market: new MarketAgent(),
  smartMoney: new SmartMoneyAgent(),
  narrative: new NarrativeAgent(),
  chiefAI: new ChiefAI(),
} as const;

export type Agents = typeof agents;
