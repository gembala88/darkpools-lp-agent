import { MarketRegimeEngine } from '../src/ai/marketRegimeEngine.js';
import { PoolActivityEngine } from '../src/ai/poolActivityEngine.js';
import { AccumulationDetector } from '../src/ai/accumulationDetector.js';
import { WhaleExitProbabilityEngine } from '../src/ai/whaleExitProbabilityEngine.js';
import { SmartMoneyFlowEngine } from '../src/ai/smartMoneyFlowEngine.js';
import { AICandleIntelligenceEngine } from '../src/ai/aiCandleIntelligenceEngine.js';
import { MarketPsychologyEngine } from '../src/ai/marketPsychologyEngine.js';
import { DynamicWeightEngine } from '../src/ai/dynamicWeightEngine.js';
import { AIAnalystLayer } from '../src/ai/aiAnalystLayer.js';
import { MultiAgentSystem } from '../src/ai/multiAgentSystem.js';
import { ChiefAiDecisionSystem } from '../src/ai/chiefAiDecisionSystem.js';
import { repositories } from '../src/repositories/index.js';
import type { MarketData, TransactionData, LiquiditySnapshot, HolderData } from '../src/types/index.js';

const POOL = 'live-val-pool';
const MINT = 'live-val-mint';
const NOW = Date.now();

interface RecommendationRecord {
  timestamp: string;
  round: number;
  pool: string;
  alphaScore: number;
  momentumScore: number;
  marketRegime: string;
  regimeScore: number;
  poolActivity: string;
  poolActivityScore: number;
  accumulationSignal: string;
  accumulationScore: number;
  whaleExitScore: number;
  whaleExitProb: number;
  whaleRisk: string;
  smartMoneyFlowSignal: string;
  smartMoneyFlowScore: number;
  candleSignal: string;
  candleScore: number;
  marketPsychology: string;
  psychologyScore: number;
  analystScore: number;
  analystConfidence: number;
  analystConsensus: string;
  multiAgentScore: number;
  multiAgentAgreement: number;
  chiefAction: string;
  chiefConfidence: number;
  chiefWarnings: string[];
  expectedRegime: string;
  expectedActivity: string;
  expectedPsychology: string;
  expectedAccumulation: string;
  expectedWhaleRisk: string;
  expectedSMFlow: string;
  expectedChiefAction: string;
  passed: string[];
  failed: string[];
  score: number;
}

const ALL_RECORDS: RecommendationRecord[] = [];

function mkTx(overrides: Partial<TransactionData>): TransactionData {
  return {
    signature: `lv-sig-${Math.random().toString(36).slice(2, 10)}`,
    poolAddress: POOL,
    tokenMint: MINT,
    type: 'buy',
    amount: 1000,
    volumeUsd: 10000,
    price: 1.0,
    walletAddress: `lv-wallet-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(NOW - 60000),
    isSmartMoney: false,
    uniqueKey: `${POOL}:${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

function mkMarket(overrides: Partial<MarketData>): MarketData {
  return {
    poolAddress: POOL, tokenMint: MINT,
    price: 1.0, volume5m: 0, volume15m: 0, volume30m: 0, volume1h: 0, volume24h: 0,
    txCount5m: 0, txCount15m: 0, txCount30m: 0, txCount1h: 0,
    buyVolume5m: 0, sellVolume5m: 0,
    buyCount5m: 0, sellCount5m: 0,
    uniqueTraders5m: 0, uniqueTraders15m: 0, uniqueTraders1h: 0, uniqueTraders4h: 0,
    timestamp: new Date(),
    ...overrides,
  };
}

function mkLiq(overrides: Partial<LiquiditySnapshot>): LiquiditySnapshot {
  return {
    poolAddress: POOL, tokenMint: MINT,
    liquidity: 50000, tvl: 100000, activeBinLiquidity: 30000,
    timestamp: new Date(), source: 'live-val',
    ...overrides,
  };
}

function mkHolder(overrides: Partial<HolderData>): HolderData {
  return {
    address: `lv-holder-${Math.random().toString(36).slice(2, 8)}`,
    tokenMint: MINT, balance: 10000, percentage: 1,
    firstSeen: new Date(NOW - 86400000), lastSeen: new Date(),
    transactionCount: 10, tags: [],
    ...overrides,
  };
}

async function clearRepos(): Promise<void> {
  const mkt = repositories.market as unknown as { snapshots: MarketData[] };
  const liq = repositories.liquidity as unknown as { snapshots: LiquiditySnapshot[] };
  const txRepo = repositories.transaction as unknown as {
    transactions: TransactionData[]; seenSignatures: Set<string>;
    listCache: { clear: () => void }; cache: Map<string, unknown>;
  };
  const holderRepo = repositories.holder as unknown as {
    holders: Map<string, HolderData>; listCache: { clear: () => void };
  };
  const tokenRepo = repositories.token as unknown as { tokens: Map<string, unknown> };
  if (Array.isArray(mkt.snapshots)) mkt.snapshots = [];
  if (Array.isArray(liq.snapshots)) liq.snapshots = [];
  txRepo.transactions = [];
  txRepo.seenSignatures = new Set();
  holderRepo.holders = new Map();
  tokenRepo.tokens = new Map();
  if (txRepo.listCache && typeof txRepo.listCache.clear === 'function') txRepo.listCache.clear();
  if (holderRepo.listCache && typeof holderRepo.listCache.clear === 'function') holderRepo.listCache.clear();
  if (txRepo.cache) txRepo.cache.clear();
}

interface ScenarioArchetype {
  name: string;
  expectedRegime: string;
  expectedActivity: string;
  expectedPsychology: string;
  expectedAccumulation: string;
  expectedWhaleRisk: string;
  expectedSMFlow: string;
  expectedChiefAction: string;
  generateParams: (rng: () => number) => {
    market: Partial<MarketData>;
    liquidity: Partial<LiquiditySnapshot>;
    transactions: TransactionData[];
    holders: HolderData[];
    priceChanges: number[];
  };
}

function rng(): number {
  return Math.random();
}

const ARCHETYPES: ScenarioArchetype[] = [
  {
    name: 'Strong Accumulation',
    expectedRegime: 'ACCUMULATION', expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'EUPHORIA', expectedAccumulation: 'bullish',
    expectedWhaleRisk: 'low', expectedSMFlow: 'bullish', expectedChiefAction: 'DEPLOY',
    generateParams: (r: () => number) => {
      const volScale = 0.5 + r() * 1.0;
      const txScale = Math.floor(20 + r() * 40);
      return {
        market: {
          price: 1.0 + r() * 0.2, volume5m: 10000 * volScale, volume1h: 60000 * volScale, volume24h: 400000 * volScale,
          txCount5m: txScale, txCount1h: txScale * 4,
          buyVolume5m: 8000 * volScale, sellVolume5m: 2000 * volScale,
          buyCount5m: Math.floor(txScale * 0.8), sellCount5m: Math.floor(txScale * 0.2),
          uniqueTraders5m: Math.floor(15 + r() * 20), uniqueTraders15m: Math.floor(30 + r() * 30),
        },
        liquidity: { tvl: 100000 + r() * 50000, liquidity: 50000 + r() * 30000 },
        transactions: (() => {
          const txs: TransactionData[] = [];
          for (let i = 0; i < txScale; i++) {
            txs.push(mkTx({ type: 'buy', volumeUsd: 1000 + r() * 2000, isSmartMoney: i < txScale * 0.5, timestamp: new Date(NOW - i * 10000) }));
          }
          for (let i = 0; i < Math.floor(txScale * 0.15); i++) {
            txs.push(mkTx({ type: 'sell', volumeUsd: 500 + r() * 500, isSmartMoney: false, timestamp: new Date(NOW - i * 20000) }));
          }
          return txs;
        })(),
        holders: (() => {
          const h: HolderData[] = [];
          for (let i = 0; i < 3; i++) h.push(mkHolder({ address: `whale-${i}-${Math.random().toString(36).slice(2,4)}`, percentage: 6 + r() * 4, tags: ['smart_money'] }));
          for (let i = 0; i < 80; i++) h.push(mkHolder({ percentage: 0.3 + r() * 0.5 }));
          return h;
        })(),
        priceChanges: [1 + r() * 0.5, 0.5 + r() * 0.5, -0.5 + r() * 0.5, 1 + r() * 0.5, 0.5 + r() * 0.5],
      };
    },
  },
  {
    name: 'Whale Dump',
    expectedRegime: 'PANIC', expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'CAPITULATION', expectedAccumulation: 'bearish',
    expectedWhaleRisk: 'high', expectedSMFlow: 'bearish', expectedChiefAction: 'SKIP',
    generateParams: (r: () => number) => {
      const volScale = 0.5 + r() * 1.0;
      const txScale = Math.floor(40 + r() * 60);
      return {
        market: {
          price: 0.7 + r() * 0.3, volume5m: 40000 * volScale, volume1h: 200000 * volScale, volume24h: 1200000 * volScale,
          txCount5m: txScale, txCount1h: txScale * 4,
          buyVolume5m: 5000 * volScale, sellVolume5m: 35000 * volScale,
          buyCount5m: Math.floor(txScale * 0.2), sellCount5m: Math.floor(txScale * 0.8),
          uniqueTraders5m: Math.floor(5 + r() * 10), uniqueTraders15m: Math.floor(10 + r() * 15),
        },
        liquidity: { tvl: 60000 + r() * 40000, liquidity: 25000 + r() * 20000 },
        transactions: (() => {
          const txs: TransactionData[] = [];
          for (let i = 0; i < Math.floor(txScale * 0.2); i++) {
            txs.push(mkTx({ type: 'buy', volumeUsd: 500 + r() * 1000, isSmartMoney: false, timestamp: new Date(NOW - i * 5000) }));
          }
          for (let i = 0; i < Math.floor(txScale * 0.8); i++) {
            txs.push(mkTx({ type: 'sell', volumeUsd: 2000 + r() * 6000, isSmartMoney: i < Math.floor(txScale * 0.1), timestamp: new Date(NOW - i * 3000) }));
          }
          return txs;
        })(),
        holders: (() => {
          const h: HolderData[] = [];
          for (let i = 0; i < 3; i++) h.push(mkHolder({ address: `whale-${i}-${Math.random().toString(36).slice(2,4)}`, percentage: 12 + r() * 6 }));
          for (let i = 0; i < 15; i++) h.push(mkHolder({ percentage: 0.5 + r() * 1 }));
          return h;
        })(),
        priceChanges: [-0.5 + r() * -0.5, -1 + r() * -0.5, -0.5 + r() * -0.5, -0.3 + r() * -0.3, -0.8 + r() * -0.5],
      };
    },
  },
  {
    name: 'Dead Pool',
    expectedRegime: 'RANGING', expectedActivity: 'DEAD',
    expectedPsychology: 'NEUTRAL', expectedAccumulation: 'neutral',
    expectedWhaleRisk: 'low', expectedSMFlow: 'neutral', expectedChiefAction: 'SKIP',
    generateParams: (_r: () => number) => ({
      market: { price: 0.3 + Math.random() * 0.4, volume5m: 0, volume1h: 0, volume24h: 10 + Math.random() * 90, txCount5m: 0, txCount1h: 0, buyVolume5m: 0, sellVolume5m: 0, buyCount5m: 0, sellCount5m: 0, uniqueTraders5m: 0 },
      liquidity: { tvl: 2000 + Math.random() * 6000, liquidity: 1000 + Math.random() * 3000 },
      transactions: [],
      holders: [mkHolder({ address: 'dead-whale', percentage: 95 + Math.random() * 5, balance: 50000 })],
      priceChanges: [0, 0, 0, 0, 0],
    }),
  },
  {
    name: 'Euphoria',
    expectedRegime: 'EUPHORIA', expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'EUPHORIA', expectedAccumulation: 'bullish',
    expectedWhaleRisk: 'low', expectedSMFlow: 'bullish', expectedChiefAction: 'DEPLOY',
    generateParams: (r: () => number) => {
      const volScale = 0.5 + r() * 1.0;
      const txScale = Math.floor(150 + r() * 200);
      return {
        market: {
          price: 2.0 + r() * 1.0, volume5m: 150000 * volScale, volume1h: 600000 * volScale, volume24h: 4000000 * volScale,
          txCount5m: txScale, txCount1h: txScale * 4,
          buyVolume5m: 130000 * volScale, sellVolume5m: 20000 * volScale,
          buyCount5m: Math.floor(txScale * 0.85), sellCount5m: Math.floor(txScale * 0.15),
          uniqueTraders5m: Math.floor(100 + r() * 100), uniqueTraders15m: Math.floor(200 + r() * 200),
        },
        liquidity: { tvl: 400000 + r() * 200000, liquidity: 200000 + r() * 100000 },
        transactions: (() => {
          const txs: TransactionData[] = [];
          for (let i = 0; i < Math.floor(txScale * 0.85); i++) {
            txs.push(mkTx({ type: 'buy', volumeUsd: 3000 + r() * 8000, isSmartMoney: i < Math.floor(txScale * 0.3), timestamp: new Date(NOW - i * 2000) }));
          }
          for (let i = 0; i < Math.floor(txScale * 0.15); i++) {
            txs.push(mkTx({ type: 'sell', volumeUsd: 500 + r() * 2000, isSmartMoney: false, timestamp: new Date(NOW - i * 10000) }));
          }
          return txs;
        })(),
        holders: (() => {
          const h: HolderData[] = [];
          for (let i = 0; i < 5; i++) h.push(mkHolder({ address: `whale-${i}-${Math.random().toString(36).slice(2,4)}`, percentage: 8 + r() * 4, transactionCount: 50 + Math.floor(r() * 50) }));
          for (let i = 0; i < 150; i++) h.push(mkHolder({ percentage: 0.15 + r() * 0.2 }));
          return h;
        })(),
        priceChanges: [2 + r() * 1, 1.5 + r() * 1, -0.5 + r() * 0.5, 2.5 + r() * 1, 1 + r() * 0.5],
      };
    },
  },
  {
    name: 'Distribution',
    expectedRegime: 'DISTRIBUTION', expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'FEAR', expectedAccumulation: 'bearish',
    expectedWhaleRisk: 'high', expectedSMFlow: 'bearish', expectedChiefAction: 'SKIP',
    generateParams: (r: () => number) => {
      const volScale = 0.5 + r() * 1.0;
      const txScale = Math.floor(30 + r() * 40);
      return {
        market: {
          price: 0.9 + r() * 0.4, volume5m: 25000 * volScale, volume1h: 120000 * volScale, volume24h: 700000 * volScale,
          txCount5m: txScale, txCount1h: txScale * 4,
          buyVolume5m: 10000 * volScale, sellVolume5m: 15000 * volScale,
          buyCount5m: Math.floor(txScale * 0.4), sellCount5m: Math.floor(txScale * 0.6),
          uniqueTraders5m: Math.floor(20 + r() * 20), uniqueTraders15m: Math.floor(40 + r() * 30),
        },
        liquidity: { tvl: 80000 + r() * 50000, liquidity: 35000 + r() * 30000 },
        transactions: (() => {
          const txs: TransactionData[] = [];
          for (let i = 0; i < Math.floor(txScale * 0.4); i++) {
            txs.push(mkTx({ type: 'buy', volumeUsd: 800 + r() * 1500, isSmartMoney: i < Math.floor(txScale * 0.1), timestamp: new Date(NOW - i * 8000) }));
          }
          for (let i = 0; i < Math.floor(txScale * 0.6); i++) {
            txs.push(mkTx({ type: 'sell', volumeUsd: 1500 + r() * 3500, isSmartMoney: i > Math.floor(txScale * 0.4), timestamp: new Date(NOW - i * 5000) }));
          }
          return txs;
        })(),
        holders: (() => {
          const h: HolderData[] = [];
          for (let i = 0; i < 5; i++) h.push(mkHolder({ address: `whale-${i}-${Math.random().toString(36).slice(2,4)}`, percentage: 10 + r() * 4, tags: ['smart_money'] }));
          for (let i = 0; i < 40; i++) h.push(mkHolder({ percentage: 0.3 + r() * 0.5 }));
          return h;
        })(),
        priceChanges: [-0.3 + r() * -0.3, -0.5 + r() * -0.3, 0.2 + r() * 0.3, -0.4 + r() * -0.3, -0.2 + r() * -0.3],
      };
    },
  },
  {
    name: 'Mixed Signals',
    expectedRegime: 'ACCUMULATION', expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'GREED', expectedAccumulation: 'bullish',
    expectedWhaleRisk: 'high', expectedSMFlow: 'bullish', expectedChiefAction: 'SIMULATE',
    generateParams: (r: () => number) => {
      const volScale = 0.5 + r() * 1.0;
      const txScale = Math.floor(20 + r() * 30);
      return {
        market: {
          price: 1.0 + r() * 0.4, volume5m: 15000 * volScale, volume1h: 80000 * volScale, volume24h: 500000 * volScale,
          txCount5m: txScale, txCount1h: txScale * 4,
          buyVolume5m: 11000 * volScale, sellVolume5m: 4000 * volScale,
          buyCount5m: Math.floor(txScale * 0.7), sellCount5m: Math.floor(txScale * 0.3),
          uniqueTraders5m: Math.floor(15 + r() * 15), uniqueTraders15m: Math.floor(30 + r() * 20),
        },
        liquidity: { tvl: 120000 + r() * 60000, liquidity: 60000 + r() * 30000 },
        transactions: (() => {
          const txs: TransactionData[] = [];
          for (let i = 0; i < Math.floor(txScale * 0.7); i++) {
            txs.push(mkTx({ type: 'buy', volumeUsd: 1500 + r() * 3000, isSmartMoney: i < Math.floor(txScale * 0.5), timestamp: new Date(NOW - i * 8000) }));
          }
          for (let i = 0; i < Math.floor(txScale * 0.3); i++) {
            txs.push(mkTx({ type: 'sell', volumeUsd: 4000 + r() * 5000, isSmartMoney: i < Math.floor(txScale * 0.05), timestamp: new Date(NOW - i * 15000) }));
          }
          return txs;
        })(),
        holders: (() => {
          const h: HolderData[] = [];
          for (let i = 0; i < 2; i++) h.push(mkHolder({ address: `whale-${i}-${Math.random().toString(36).slice(2,4)}`, percentage: 22 + r() * 6 }));
          for (let i = 0; i < 60; i++) h.push(mkHolder({ percentage: 0.3 + r() * 0.4 }));
          return h;
        })(),
        priceChanges: [0.5 + r() * 0.5, 1 + r() * 0.5, -0.5 + r() * 0.5, 0.8 + r() * 0.5, 0.3 + r() * 0.3],
      };
    },
  },
];

async function runLiveRound(round: number, archetype: ScenarioArchetype): Promise<RecommendationRecord> {
  await clearRepos();
  const params = archetype.generateParams(rng);

  await Promise.all([
    repositories.market.add(mkMarket(params.market)),
    repositories.liquidity.add(mkLiq(params.liquidity)),
  ]);
  for (const tx of params.transactions) await repositories.transaction.add(tx);
  for (const h of params.holders) await repositories.holder.upsert(h);

  const marketRegime = new MarketRegimeEngine();
  const poolActivity = new PoolActivityEngine();
  const accumulation = new AccumulationDetector();
  const whaleExit = new WhaleExitProbabilityEngine();
  const smFlow = new SmartMoneyFlowEngine();
  const candle = new AICandleIntelligenceEngine();
  const psychology = new MarketPsychologyEngine();
  const dynamicWeight = new DynamicWeightEngine();
  const analyst = new AIAnalystLayer();
  const multiAgent = new MultiAgentSystem();
  const chief = new ChiefAiDecisionSystem();

  const engines: Record<string, { score: number; signal: string; reason: string; metadata: Record<string, unknown> }> = {};

  engines['marketRegime'] = await marketRegime.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['poolActivity'] = await poolActivity.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['accumulation'] = await accumulation.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['smartMoneyFlow'] = await smFlow.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['candleIntelligence'] = await candle.evaluate({ poolAddress: POOL, tokenMint: MINT, priceChanges: params.priceChanges });
  engines['marketPsychology'] = await psychology.evaluate({ poolAddress: POOL, tokenMint: MINT });

  const poolActivityScore = engines['poolActivity'].metadata?.activityLevel === 'DEAD' ? 5 :
    engines['poolActivity'].metadata?.activityLevel === 'LOW' ? 25 :
    engines['poolActivity'].metadata?.activityLevel === 'NORMAL' ? 50 :
    engines['poolActivity'].metadata?.activityLevel === 'ACTIVE' ? 75 : 95;
  engines['whaleExit'] = await whaleExit.evaluate({ poolAddress: POOL, tokenMint: MINT, activityScore: poolActivityScore });

  const regime = engines['marketRegime'].metadata?.regime as string ?? 'RANGING';
  const activity = engines['poolActivity'].metadata?.activityLevel as string ?? 'DEAD';
  const psych = engines['marketPsychology'].metadata?.psychology as string ?? 'NEUTRAL';

  const dwResult = await dynamicWeight.evaluate({ marketRegime: regime, confidence: 80 });
  const analystResult = await analyst.evaluate({
    engineResults: Object.entries(engines).map(([e, r]) => ({ engine: e, score: r.score, signal: r.signal, reason: r.reason, metadata: r.metadata })),
    weights: dwResult.metadata?.weights,
  });
  const agentResult = await multiAgent.evaluate({
    engineResults: Object.entries(engines).map(([e, r]) => ({ engine: e, score: r.score, signal: r.signal, reason: r.reason })),
  });
  const chiefResult = await chief.evaluate({
    analystResult: {
      overallScore: analystResult.score,
      confidence: analystResult.metadata?.confidence as number,
      weightedScore: analystResult.metadata?.weightedScore as number,
      consensusSignal: analystResult.metadata?.consensusSignal as string,
    },
    agentResult: { score: agentResult.score, metadata: agentResult.metadata },
    marketRegimeScore: engines['marketRegime'].score,
    poolActivityScore: engines['poolActivity'].score,
    whaleExitScore: engines['whaleExit'].score,
    deploymentMemoryScore: 50,
    selfLearningScore: 50,
  });

  const chiefMeta = chiefResult.metadata as { recommendation?: { action?: string; warnings?: string[] }; warnings?: string[] };
  const chiefAction = (chiefMeta?.recommendation?.action ?? 'WATCHLIST') as string;
  const chiefWarnings = (chiefMeta?.recommendation?.warnings ?? chiefMeta?.warnings ?? []) as string[];

  const passed: string[] = [];
  const failed: string[] = [];

  if (regime === archetype.expectedRegime) passed.push('marketRegime'); else failed.push(`marketRegime: got ${regime}, expected ${archetype.expectedRegime}`);
  if (activity === archetype.expectedActivity) passed.push('poolActivity'); else failed.push(`poolActivity: got ${activity}, expected ${archetype.expectedActivity}`);
  if (psych === archetype.expectedPsychology) passed.push('marketPsychology'); else failed.push(`marketPsychology: got ${psych}, expected ${archetype.expectedPsychology}`);
  const accSignal = engines['accumulation'].signal;
  if (accSignal === archetype.expectedAccumulation) passed.push('accumulation'); else failed.push(`accumulation: got ${accSignal}, expected ${archetype.expectedAccumulation}`);
  const whaleScore = engines['whaleExit'].score;
  const whaleRisk = whaleScore >= 70 ? 'low' : whaleScore >= 40 ? 'medium' : 'high';
  if (whaleRisk === archetype.expectedWhaleRisk) passed.push('whaleExit'); else failed.push(`whaleExit: got ${whaleRisk} (score=${whaleScore}), expected ${archetype.expectedWhaleRisk}`);
  const smSignal = engines['smartMoneyFlow'].signal;
  if (smSignal === archetype.expectedSMFlow) passed.push('smartMoneyFlow'); else failed.push(`smartMoneyFlow: got ${smSignal}, expected ${archetype.expectedSMFlow}`);
  if (chiefAction === archetype.expectedChiefAction) passed.push('chiefAI'); else failed.push(`chiefAI: got ${chiefAction}, expected ${archetype.expectedChiefAction}`);

  const weMeta = engines['whaleExit'].metadata as { exitProbability?: number };

  return {
    timestamp: new Date().toISOString(),
    round,
    pool: POOL,
    alphaScore: 50 + (engines['marketRegime'].score - 50) * 0.3 + (engines['accumulation'].score - 50) * 0.3 + (engines['smartMoneyFlow'].score - 50) * 0.2,
    momentumScore: engines['candleIntelligence'].score,
    marketRegime: regime,
    regimeScore: engines['marketRegime'].score,
    poolActivity: activity,
    poolActivityScore: engines['poolActivity'].score,
    accumulationSignal: accSignal,
    accumulationScore: engines['accumulation'].score,
    whaleExitScore: whaleScore,
    whaleExitProb: weMeta?.exitProbability ?? 0,
    whaleRisk,
    smartMoneyFlowSignal: smSignal,
    smartMoneyFlowScore: engines['smartMoneyFlow'].score,
    candleSignal: engines['candleIntelligence'].signal,
    candleScore: engines['candleIntelligence'].score,
    marketPsychology: psych,
    psychologyScore: engines['marketPsychology'].score,
    analystScore: analystResult.score,
    analystConfidence: analystResult.metadata?.confidence as number,
    analystConsensus: analystResult.metadata?.consensusSignal as string,
    multiAgentScore: agentResult.score,
    multiAgentAgreement: agentResult.metadata?.agreementRatio as number,
    chiefAction,
    chiefConfidence: chiefMeta?.recommendation?.confidence as number,
    chiefWarnings,
    expectedRegime: archetype.expectedRegime,
    expectedActivity: archetype.expectedActivity,
    expectedPsychology: archetype.expectedPsychology,
    expectedAccumulation: archetype.expectedAccumulation,
    expectedWhaleRisk: archetype.expectedWhaleRisk,
    expectedSMFlow: archetype.expectedSMFlow,
    expectedChiefAction: archetype.expectedChiefAction,
    passed,
    failed,
    score: passed.length / (passed.length + failed.length) * 100,
  };
}

function computeMetrics(records: RecommendationRecord[]): Record<string, unknown> {
  const total = records.length;
  if (total === 0) return { error: 'no records' };
  const passes = records.filter(r => r.failed.length === 0).length;
  const overallAccuracy = passes / total * 100;

  const engineChecks: Record<string, { pass: number; fail: number }> = {};
  for (const r of records) {
    for (const p of r.passed) { if (!engineChecks[p]) engineChecks[p] = { pass: 0, fail: 0 }; engineChecks[p].pass++; }
    for (const f of r.failed) {
      const engineName = f.split(':')[0];
      if (!engineChecks[engineName]) engineChecks[engineName] = { pass: 0, fail: 0 };
      engineChecks[engineName].fail++;
    }
  }

  const engineAccuracy: Record<string, number> = {};
  for (const [name, counts] of Object.entries(engineChecks)) {
    engineAccuracy[name] = counts.pass / (counts.pass + counts.fail) * 100;
  }

  const chiefActions = records.map(r => r.chiefAction);
  const actionDistribution: Record<string, number> = {};
  for (const a of chiefActions) { actionDistribution[a] = (actionDistribution[a] ?? 0) + 1; }

  const avgConfidence = records.reduce((s, r) => s + r.analystConfidence, 0) / total;
  const avgChiefConfidence = records.reduce((s, r) => s + r.chiefConfidence, 0) / total;
  const avgAgreement = records.reduce((s, r) => s + r.multiAgentAgreement, 0) / total;

  const falsePositives = records.filter(r => r.failed.length > 0 && r.chiefAction === 'DEPLOY').length;
  const falseNegatives = records.filter(r => r.failed.length === 0 && r.chiefAction === 'SKIP').length;

  return {
    totalRounds: total,
    overallAccuracy: Number(overallAccuracy.toFixed(1)),
    engineAccuracy,
    actionDistribution,
    avgAnalystConfidence: Number(avgConfidence.toFixed(1)),
    avgChiefConfidence: Number(avgChiefConfidence.toFixed(1)),
    avgMultiAgentAgreement: Number(avgAgreement.toFixed(2)),
    falsePositives,
    falseNegatives,
    scenariosWithoutFailures: passes,
    scenariosWithFailures: total - passes,
  };
}

async function main(): Promise<void> {
  const ROUNDS = 60;
  const startTime = Date.now();

  console.log('='.repeat(90));
  console.log('  LIVE PAPER VALIDATION — AI INTELLIGENCE LAYER');
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log(`  Rounds per archetype: ${ROUNDS} (360 total evaluations)`);
  console.log('='.repeat(90));
  console.log();

  let totalPassed = 0;
  let totalFailed = 0;

  for (const archetype of ARCHETYPES) {
    console.log(`\n▶ Archetype: ${archetype.name}`);
    console.log('-'.repeat(60));

    let archPassed = 0;
    let archFailed = 0;

    for (let round = 0; round < ROUNDS; round++) {
      const record = await runLiveRound(round, archetype);
      ALL_RECORDS.push(record);

      if (record.failed.length === 0) {
        archPassed++;
        totalPassed++;
      } else {
        archFailed++;
        totalFailed++;
      }
    }

    const archRate = (archPassed / ROUNDS * 100).toFixed(0);
    console.log(`  ${archPassed}/${ROUNDS} passed (${archRate}%)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Save all records
  const fs = await import('fs/promises');
  await fs.writeFile('scripts/live_validation_log.json', JSON.stringify(ALL_RECORDS, null, 2));

  // Compute metrics
  const metrics = computeMetrics(ALL_RECORDS);
  await fs.writeFile('scripts/live_validation_metrics.json', JSON.stringify(metrics, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(90));
  console.log('  LIVE VALIDATION SUMMARY');
  console.log('='.repeat(90));
  console.log(`  Duration: ${elapsed}s (simulated 360 rounds)`);
  console.log(`  Total evaluations: ${ALL_RECORDS.length}`);
  console.log(`  Overall accuracy: ${(metrics.overallAccuracy as number).toFixed(1)}%`);
  console.log(`  Passed: ${totalPassed}, Failed: ${totalFailed}`);
  console.log();

  console.log('  Engine-Level Accuracy:');
  const ea = metrics.engineAccuracy as Record<string, number>;
  for (const [name, rate] of Object.entries(ea)) {
    const bar = '█'.repeat(Math.round(rate / 10)) + '░'.repeat(10 - Math.round(rate / 10));
    console.log(`  [${bar}] ${name.padEnd(18)} ${rate.toFixed(0)}%`);
  }

  console.log('\n  Chief AI Action Distribution:');
  const ad = metrics.actionDistribution as Record<string, number>;
  for (const [action, count] of Object.entries(ad)) {
    console.log(`    ${action}: ${count}`);
  }

  console.log(`\n  Average Analyst Confidence: ${metrics.avgAnalystConfidence}%`);
  console.log(`  Average Chief Confidence: ${metrics.avgChiefConfidence}%`);
  console.log(`  Average Multi-Agent Agreement: ${metrics.avgMultiAgentAgreement}`);
  console.log(`  False Positives (DEPLOY when wrong): ${metrics.falsePositives}`);
  console.log(`  False Negatives (SKIP when correct): ${metrics.falseNegatives}`);

  console.log(`\n  Log saved to scripts/live_validation_log.json`);
  console.log(`  Metrics saved to scripts/live_validation_metrics.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
