import { RiskAgentOutput } from './riskAgent.js';
import { MomentumAgentOutput } from './momentumAgent.js';
import { WhaleAgentOutput } from './whaleAgent.js';
import { MarketAgentOutput } from './marketAgent.js';
import { SmartMoneyAgentOutput } from './smartMoneyAgent.js';
import { NarrativeAgentOutput } from './narrativeAgent.js';

export interface AllAgentOutputs {
  risk: RiskAgentOutput;
  momentum: MomentumAgentOutput;
  whale: WhaleAgentOutput;
  market: MarketAgentOutput;
  smartMoney: SmartMoneyAgentOutput;
  narrative: NarrativeAgentOutput;
}

export interface ChiefOutput {
  recommendation: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'SKIP' | 'AVOID';
  confidence: number;
  reasoning: string;
  signals: Array<{ agent: string; score: number; signal: string }>;
}

type AgentKey = keyof AllAgentOutputs;

const REGIME_WEIGHTS: Record<string, Partial<Record<AgentKey, number>>> = {
  ACCUMULATION: { smartMoney: 1.5, risk: 1.2, market: 1.2 },
  TRENDING_BULLISH: { momentum: 1.5, narrative: 1.3, market: 1.2 },
  TRENDING_BEARISH: { risk: 1.5, whale: 1.3, market: 1.2 },
  DISTRIBUTION: { risk: 1.3, whale: 1.5, smartMoney: 1.2 },
  PANIC: { risk: 2.0, market: 1.5, whale: 1.3 },
  EUPHORIA: { risk: 1.5, market: 1.3, narrative: 1.2 },
  RANGING: { momentum: 1.2, narrative: 1.2 },
};

const VETO_SIGNALS: Partial<Record<AgentKey, string[]>> = {
  risk: ['CRITICAL', 'DANGER'],
};

export class ChiefAI {
  readonly name = 'chiefAI';

  evaluate(agents: AllAgentOutputs, marketRegime = 'RANGING'): ChiefOutput {
    const weights = REGIME_WEIGHTS[marketRegime] ?? {};
    const agentKeys: AgentKey[] = ['risk', 'momentum', 'whale', 'market', 'smartMoney', 'narrative'];

    const vetos: string[] = [];
    const signals: ChiefOutput['signals'] = [];

    for (const key of agentKeys) {
      const agent = agents[key];
      const vetoSignals = VETO_SIGNALS[key] ?? [];
      if (vetoSignals.includes(agent.signal)) {
        vetos.push(`${key}=${agent.signal} (veto)`);
      }
      signals.push({ agent: key, score: agent.score, signal: agent.signal });
    }

    let totalWeight = 0;
    let weightedSum = 0;
    for (const key of agentKeys) {
      const w = weights[key] ?? 1.0;
      totalWeight += w;
      weightedSum += agents[key].score * w;
    }
    const avgScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

    const positiveCount = signals.filter(s => s.score >= 55).length;
    const agreement = positiveCount >= 4;

    let recommendation: ChiefOutput['recommendation'];
    let confidence: number;

    if (vetos.length > 0) {
      recommendation = 'AVOID';
      confidence = 0;
    } else if (avgScore >= 75 && agreement) {
      recommendation = 'STRONG_BUY';
      confidence = Math.min(100, Math.round(avgScore));
    } else if (avgScore >= 60 && agreement) {
      recommendation = 'BUY';
      confidence = Math.round(avgScore);
    } else if (avgScore >= 45) {
      recommendation = 'WATCH';
      confidence = Math.round(avgScore);
    } else if (avgScore >= 30) {
      recommendation = 'SKIP';
      confidence = Math.round(avgScore);
    } else {
      recommendation = 'AVOID';
      confidence = Math.round(avgScore);
    }

    const reasoningParts: string[] = [];
    if (vetos.length > 0) reasoningParts.push(`Veto: ${vetos.join(', ')}`);
    reasoningParts.push(`avg=${avgScore.toFixed(0)} agreement=${positiveCount}/6`);
    const topSignal = signals.sort((a, b) => b.score - a.score)[0];
    const bottomSignal = signals.sort((a, b) => a.score - b.score)[0];
    reasoningParts.push(`best=${topSignal.agent}(${topSignal.signal}) worst=${bottomSignal.agent}(${bottomSignal.signal})`);

    return { recommendation, confidence, reasoning: reasoningParts.join(' | '), signals };
  }
}
