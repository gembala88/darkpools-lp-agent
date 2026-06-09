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
import { LpAlphaScoreEngine } from '../src/engines/lpAlphaScoreEngine.js';
import { DeploymentDecisionEngine } from '../src/engines/deploymentDecisionEngine.js';
import { LpMomentumEngine } from '../src/engines/lpMomentumEngine.js';
import { repositories } from '../src/repositories/index.js';
import type { MarketData, TransactionData, LiquiditySnapshot, HolderData, TokenData } from '../src/types/index.js';

// ─── Test Scenario Definitions ───────────────────────────────────────

interface Scenario {
  name: string;
  description: string;
  expectedRegime: string;
  expectedActivity: string;
  expectedPsychology: string;
  expectedAccumulation: 'bullish' | 'bearish' | 'neutral';
  expectedWhaleRisk: 'low' | 'medium' | 'high';
  expectedSMFlow: 'bullish' | 'bearish' | 'neutral';
  expectedChiefAction: string;
  populate: () => Promise<void>;
}

const POOL = 'paper-test-pool';
const MINT = 'paper-test-mint';
const NOW = Date.now();
const SCENARIO_POOLS = new Map<string, string>();

function mkTx(overrides: Partial<TransactionData>): TransactionData {
  return {
    signature: `sig-${Math.random().toString(36).slice(2, 10)}`,
    poolAddress: POOL,
    tokenMint: MINT,
    type: 'buy',
    amount: 1000,
    volumeUsd: 10000,
    price: 1.0,
    walletAddress: `wallet-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(NOW - 60000),
    isSmartMoney: false,
    uniqueKey: `${POOL}:${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

function mkMarket(overrides: Partial<MarketData>): MarketData {
  return {
    poolAddress: POOL,
    tokenMint: MINT,
    price: 1.0,
    volume5m: 0, volume15m: 0, volume30m: 0, volume1h: 0, volume24h: 0,
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
    poolAddress: POOL,
    tokenMint: MINT,
    liquidity: 50000,
    tvl: 100000,
    activeBinLiquidity: 30000,
    timestamp: new Date(),
    source: 'test',
    ...overrides,
  };
}

function mkHolder(overrides: Partial<HolderData>): HolderData {
  return {
    address: `holder-${Math.random().toString(36).slice(2, 8)}`,
    tokenMint: MINT,
    balance: 10000,
    percentage: 1,
    firstSeen: new Date(NOW - 86400000),
    lastSeen: new Date(),
    transactionCount: 10,
    tags: [],
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
    holders: Map<string, HolderData>;
    listCache: { clear: () => void };
  };
  const tokenRepo = repositories.token as unknown as { tokens: Map<string, TokenData> };

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

// ─── Scenarios ───────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    name: 'Strong Accumulation',
    description: 'High buy volume, smart money accumulating, low whale risk',
    expectedRegime: 'ACCUMULATION',
    expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'EUPHORIA',
    expectedAccumulation: 'bullish',
    expectedWhaleRisk: 'low',
    expectedSMFlow: 'bullish',
    expectedChiefAction: 'DEPLOY',
    populate: async () => {
      await Promise.all([
        repositories.market.add(mkMarket({
          price: 1.05, volume5m: 15000, volume1h: 80000, volume24h: 500000,
          txCount5m: 45, txCount1h: 200,
          buyVolume5m: 12000, sellVolume5m: 3000,
          buyCount5m: 35, sellCount5m: 10,
          uniqueTraders5m: 25, uniqueTraders15m: 50, uniqueTraders1h: 80,
        })),
        repositories.liquidity.add(mkLiq({ tvl: 120000, liquidity: 60000 })),
      ]);
      const txs: TransactionData[] = [];
      for (let i = 0; i < 30; i++) {
        txs.push(mkTx({
          type: 'buy', volumeUsd: 1000 + Math.random() * 2000,
          isSmartMoney: i < 15, timestamp: new Date(NOW - i * 10000),
        }));
      }
      for (let i = 0; i < 5; i++) {
        txs.push(mkTx({
          type: 'sell', volumeUsd: 500 + Math.random() * 500,
          isSmartMoney: false, timestamp: new Date(NOW - i * 20000),
        }));
      }
      for (const tx of txs) {
        await repositories.transaction.add(tx);
      }
      for (let i = 0; i < 3; i++) {
        await repositories.holder.upsert(mkHolder({
          address: `whale-${i}`, percentage: 8 - i * 2, balance: 80000 - i * 20000,
          tags: ['smart_money', 'long_term'],
        }));
      }
      for (let i = 0; i < 100; i++) {
        await repositories.holder.upsert(mkHolder({ percentage: 0.5, tags: [] }));
      }
    },
  },
  {
    name: 'Whale Dump',
    description: 'Top holders selling, high sell volume, panic',
    expectedRegime: 'PANIC',
    expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'CAPITULATION',
    expectedAccumulation: 'bearish',
    expectedWhaleRisk: 'high',
    expectedSMFlow: 'bearish',
    expectedChiefAction: 'SKIP',
    populate: async () => {
      await Promise.all([
        repositories.market.add(mkMarket({
          price: 0.85, volume5m: 50000, volume1h: 250000, volume24h: 1500000,
          txCount5m: 80, txCount1h: 400,
          buyVolume5m: 8000, sellVolume5m: 42000,
          buyCount5m: 15, sellCount5m: 65,
          uniqueTraders5m: 10, uniqueTraders15m: 20, uniqueTraders1h: 40,
        })),
        repositories.liquidity.add(mkLiq({ tvl: 80000, liquidity: 30000 })),
      ]);
      const txs: TransactionData[] = [];
      for (let i = 0; i < 10; i++) {
        txs.push(mkTx({
          type: 'buy', volumeUsd: 500 + Math.random() * 1000,
          isSmartMoney: false, timestamp: new Date(NOW - i * 5000),
        }));
      }
      for (let i = 0; i < 40; i++) {
        txs.push(mkTx({
          type: 'sell', volumeUsd: 3000 + Math.random() * 5000,
          isSmartMoney: i < 5, timestamp: new Date(NOW - i * 3000),
        }));
      }
      for (const tx of txs) await repositories.transaction.add(tx);
      for (let i = 0; i < 3; i++) {
        await repositories.holder.upsert(mkHolder({
          address: `whale-${i}`, percentage: 15 - i * 3,
          balance: 150000 - i * 30000,
        }));
      }
      for (let i = 0; i < 20; i++) {
        await repositories.holder.upsert(mkHolder({ percentage: 1, tags: [] }));
      }
    },
  },
  {
    name: 'Dead Pool',
    description: 'No activity, stale data, zero transactions',
    expectedRegime: 'RANGING',
    expectedActivity: 'DEAD',
    expectedPsychology: 'NEUTRAL',
    expectedAccumulation: 'neutral',
    expectedWhaleRisk: 'low',
    expectedSMFlow: 'neutral',
    expectedChiefAction: 'SKIP',
    populate: async () => {
      await Promise.all([
        repositories.market.add(mkMarket({
          price: 0.5, volume5m: 0, volume1h: 0, volume24h: 50,
          txCount5m: 0, txCount1h: 1,
          buyVolume5m: 0, sellVolume5m: 0,
          buyCount5m: 0, sellCount5m: 0,
          uniqueTraders5m: 0,
        })),
        repositories.liquidity.add(mkLiq({ tvl: 5000, liquidity: 2000 })),
      ]);
      await repositories.holder.upsert(mkHolder({ percentage: 100, balance: 50000 }));
    },
  },
  {
    name: 'Euphoria',
    description: 'Extreme volume, very high buy pressure, euphoric sentiment',
    expectedRegime: 'EUPHORIA',
    expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'EUPHORIA',
    expectedAccumulation: 'bullish',
    expectedWhaleRisk: 'low',
    expectedSMFlow: 'bullish',
    expectedChiefAction: 'DEPLOY',
    populate: async () => {
      await Promise.all([
        repositories.market.add(mkMarket({
          price: 2.5, volume5m: 200000, volume1h: 800000, volume24h: 5000000,
          txCount5m: 300, txCount1h: 1200,
          buyVolume5m: 170000, sellVolume5m: 30000,
          buyCount5m: 250, sellCount5m: 50,
          uniqueTraders5m: 150, uniqueTraders15m: 300, uniqueTraders1h: 500,
        })),
        repositories.liquidity.add(mkLiq({ tvl: 500000, liquidity: 250000 })),
      ]);
      const txs: TransactionData[] = [];
      for (let i = 0; i < 100; i++) {
        txs.push(mkTx({
          type: 'buy', volumeUsd: 5000 + Math.random() * 10000,
          isSmartMoney: i < 30, timestamp: new Date(NOW - i * 2000),
        }));
      }
      for (let i = 0; i < 10; i++) {
        txs.push(mkTx({
          type: 'sell', volumeUsd: 1000 + Math.random() * 2000,
          isSmartMoney: false, timestamp: new Date(NOW - i * 10000),
        }));
      }
      for (const tx of txs) await repositories.transaction.add(tx);
      for (let i = 0; i < 5; i++) {
        await repositories.holder.upsert(mkHolder({
          address: `whale-${i}`, percentage: 10 - i * 2,
          balance: 50000 - i * 10000,
          transactionCount: 100 - i * 10,
        }));
      }
      for (let i = 0; i < 200; i++) {
        await repositories.holder.upsert(mkHolder({ percentage: 0.25, tags: [] }));
      }
    },
  },
  {
    name: 'Distribution',
    description: 'Smart money distributing, top holders reducing, decreasing accumulation',
    expectedRegime: 'DISTRIBUTION',
    expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'FEAR',
    expectedAccumulation: 'bearish',
    expectedWhaleRisk: 'high',
    expectedSMFlow: 'bearish',
    expectedChiefAction: 'SKIP',
    populate: async () => {
      await Promise.all([
        repositories.market.add(mkMarket({
          price: 1.1, volume5m: 30000, volume1h: 150000, volume24h: 900000,
          txCount5m: 60, txCount1h: 300,
          buyVolume5m: 12000, sellVolume5m: 18000,
          buyCount5m: 25, sellCount5m: 35,
          uniqueTraders5m: 30, uniqueTraders15m: 60, uniqueTraders1h: 100,
        })),
        repositories.liquidity.add(mkLiq({ tvl: 100000, liquidity: 45000 })),
      ]);
      const txs: TransactionData[] = [];
      for (let i = 0; i < 20; i++) {
        txs.push(mkTx({
          type: 'buy', volumeUsd: 1000 + Math.random() * 2000,
          isSmartMoney: i < 3, timestamp: new Date(NOW - i * 8000),
        }));
      }
      for (let i = 0; i < 30; i++) {
        txs.push(mkTx({
          type: 'sell', volumeUsd: 2000 + Math.random() * 3000,
          isSmartMoney: i > 20, timestamp: new Date(NOW - i * 5000),
        }));
      }
      for (const tx of txs) await repositories.transaction.add(tx);
      for (let i = 0; i < 5; i++) {
        await repositories.holder.upsert(mkHolder({
          address: `whale-${i}`, percentage: 12 - i * 2,
          balance: 120000 - i * 20000,
          tags: ['smart_money'],
        }));
      }
      for (let i = 0; i < 50; i++) {
        await repositories.holder.upsert(mkHolder({ percentage: 0.5, tags: [] }));
      }
    },
  },
  {
    name: 'Mixed Signals',
    description: 'Bullish accumulation indicators but high whale probability',
    expectedRegime: 'ACCUMULATION',
    expectedActivity: 'VERY_ACTIVE',
    expectedPsychology: 'GREED',
    expectedAccumulation: 'bullish',
    expectedWhaleRisk: 'high',
    expectedSMFlow: 'bullish',
    expectedChiefAction: 'SIMULATE',
    populate: async () => {
      await Promise.all([
        repositories.market.add(mkMarket({
          price: 1.2, volume5m: 20000, volume1h: 100000, volume24h: 600000,
          txCount5m: 40, txCount1h: 180,
          buyVolume5m: 15000, sellVolume5m: 5000,
          buyCount5m: 30, sellCount5m: 10,
          uniqueTraders5m: 20, uniqueTraders15m: 40, uniqueTraders1h: 70,
        })),
        repositories.liquidity.add(mkLiq({ tvl: 150000, liquidity: 75000 })),
      ]);
      const txs: TransactionData[] = [];
      for (let i = 0; i < 25; i++) {
        txs.push(mkTx({
          type: 'buy', volumeUsd: 2000 + Math.random() * 3000,
          isSmartMoney: i < 18, timestamp: new Date(NOW - i * 8000),
        }));
      }
      for (let i = 0; i < 8; i++) {
        txs.push(mkTx({
          type: 'sell', volumeUsd: 5000 + Math.random() * 5000,
          isSmartMoney: i < 2, timestamp: new Date(NOW - i * 15000),
        }));
      }
      for (const tx of txs) await repositories.transaction.add(tx);
      for (let i = 0; i < 2; i++) {
        await repositories.holder.upsert(mkHolder({
          address: `whale-${i}`, percentage: 25 - i * 5,
          balance: 250000 - i * 50000,
        }));
      }
      for (let i = 0; i < 80; i++) {
        await repositories.holder.upsert(mkHolder({ percentage: 0.4, tags: [] }));
      }
    },
  },
];

// ─── Simulation Runner ───────────────────────────────────────────────

interface SimulationResult {
  scenario: string;
  engines: Record<string, { score: number; signal: string; reason: string; metadata: Record<string, unknown> }>;
  analyst: { score: number; signal: string; confidence: number; consensusSignal: string };
  multiAgent: { score: number; signal: string; agreementRatio: number; consensusConfidence: number };
  chiefAI: { score: number; signal: string; action: string; confidence: number; warnings: string[] };
  expected: {
    regime: string; activity: string; psychology: string;
    accumulation: string; whaleRisk: string; smFlow: string; chiefAction: string;
  };
  passed: string[];
  failed: string[];
  score: number;
}

async function runScenario(scenario: Scenario): Promise<SimulationResult> {
  await clearRepos();
  await scenario.populate();

  const engines: SimulationResult['engines'] = {};
  const passed: string[] = [];
  const failed: string[] = [];

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

  // Run non-dependent engines in parallel
  engines['marketRegime'] = await marketRegime.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['poolActivity'] = await poolActivity.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['accumulation'] = await accumulation.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['smartMoneyFlow'] = await smFlow.evaluate({ poolAddress: POOL, tokenMint: MINT });
  engines['candleIntelligence'] = await candle.evaluate({ poolAddress: POOL, tokenMint: MINT, priceChanges: [1, 2, -1, 3, 0.5] });
  engines['marketPsychology'] = await psychology.evaluate({ poolAddress: POOL, tokenMint: MINT });

  // WhaleExit needs activityScore from poolActivity for its activity gate
  const poolActivityScore = engines['poolActivity'].metadata?.activityLevel === 'DEAD' ? 5 :
    engines['poolActivity'].metadata?.activityLevel === 'LOW' ? 25 :
    engines['poolActivity'].metadata?.activityLevel === 'NORMAL' ? 50 :
    engines['poolActivity'].metadata?.activityLevel === 'ACTIVE' ? 75 : 95;
  engines['whaleExit'] = await whaleExit.evaluate({
    poolAddress: POOL, tokenMint: MINT, activityScore: poolActivityScore,
  });

  const regime = engines['marketRegime'].metadata?.regime as string ?? 'RANGING';
  const activity = engines['poolActivity'].metadata?.activityLevel as string ?? 'UNKNOWN';
  const psych = engines['marketPsychology'].metadata?.psychology as string ?? 'NEUTRAL';

  // Dynamic weights
  const dwResult = await dynamicWeight.evaluate({ marketRegime: regime, confidence: 80 });

  // Analyst
  const analystResult = await analyst.evaluate({
    engineResults: Object.entries(engines).map(([engine, r]) => ({
      engine, score: r.score, signal: r.signal, reason: r.reason, metadata: r.metadata,
    })),
    weights: dwResult.metadata?.weights,
  });

  // Multi-agent
  const agentResult = await multiAgent.evaluate({
    engineResults: Object.entries(engines).map(([engine, r]) => ({
      engine, score: r.score, signal: r.signal, reason: r.reason,
    })),
  });

  // Chief AI
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

  // Validate expectations
  if (regime === scenario.expectedRegime) passed.push('marketRegime'); else failed.push(`marketRegime: got ${regime}, expected ${scenario.expectedRegime}`);
  if (activity === scenario.expectedActivity) passed.push('poolActivity'); else failed.push(`poolActivity: got ${activity}, expected ${scenario.expectedActivity}`);
  if (psych === scenario.expectedPsychology) passed.push('marketPsychology'); else failed.push(`marketPsychology: got ${psych}, expected ${scenario.expectedPsychology}`);

  const accSignal = engines['accumulation'].signal;
  if (accSignal === scenario.expectedAccumulation) passed.push('accumulation'); else failed.push(`accumulation: got ${accSignal}, expected ${scenario.expectedAccumulation}`);

  const whaleScore = engines['whaleExit'].score;
  const whaleRisk = whaleScore >= 70 ? 'low' : whaleScore >= 40 ? 'medium' : 'high';
  if (whaleRisk === scenario.expectedWhaleRisk) passed.push('whaleExit'); else failed.push(`whaleExit: got ${whaleRisk} (score=${whaleScore}), expected ${scenario.expectedWhaleRisk}`);

  const smSignal = engines['smartMoneyFlow'].signal;
  if (smSignal === scenario.expectedSMFlow) passed.push('smartMoneyFlow'); else failed.push(`smartMoneyFlow: got ${smSignal}, expected ${scenario.expectedSMFlow}`);

  if (chiefAction === scenario.expectedChiefAction) passed.push('chiefAI'); else failed.push(`chiefAI: got ${chiefAction}, expected ${scenario.expectedChiefAction}`);

  const score = passed.length / (passed.length + failed.length) * 100;

  return {
    scenario: scenario.name,
    engines,
    analyst: {
      score: analystResult.score,
      signal: analystResult.signal,
      confidence: analystResult.metadata?.confidence as number,
      consensusSignal: analystResult.metadata?.consensusSignal as string,
    },
    multiAgent: {
      score: agentResult.score,
      signal: agentResult.signal,
      agreementRatio: agentResult.metadata?.agreementRatio as number,
      consensusConfidence: agentResult.metadata?.consensusConfidence as number,
    },
    chiefAI: {
      score: chiefResult.score,
      signal: chiefResult.signal,
      action: chiefAction,
      confidence: chiefMeta?.recommendation?.confidence as number,
      warnings: chiefWarnings,
    },
    expected: {
      regime: scenario.expectedRegime,
      activity: scenario.expectedActivity,
      psychology: scenario.expectedPsychology,
      accumulation: scenario.expectedAccumulation,
      whaleRisk: scenario.expectedWhaleRisk,
      smFlow: scenario.expectedSMFlow,
      chiefAction: scenario.expectedChiefAction,
    },
    passed,
    failed,
    score: Math.round(score),
  };
}

// ─── Main ────────────────────────────────────────────────────────────

(async () => {
  console.log('═'.repeat(100));
  console.log('  AI PAPER TRADING SIMULATION');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═'.repeat(100));
  console.log();

  const results: SimulationResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const scenario of SCENARIOS) {
    console.log(`▶ Scenario: ${scenario.name}`);
    console.log(`  ${scenario.description}`);
    console.log('-'.repeat(80));

    const result = await runScenario(scenario);
    results.push(result);
    totalPassed += result.passed.length;
    totalFailed += result.failed.length;

    console.log(`  ✓ Passed: ${result.passed.length}, ✗ Failed: ${result.failed.length}, Score: ${result.score}%`);
    console.log(`  Regime: ${result.engines['marketRegime'].metadata?.regime} (score=${result.engines['marketRegime'].score})`);
    console.log(`  Activity: ${result.engines['poolActivity'].metadata?.activityLevel} (score=${result.engines['poolActivity'].score})`);
    console.log(`  Psychology: ${result.engines['marketPsychology'].metadata?.psychology} (score=${result.engines['marketPsychology'].score})`);
    console.log(`  Accumulation: signal=${result.engines['accumulation'].signal} (score=${result.engines['accumulation'].score})`);
    console.log(`  Whale Exit: score=${result.engines['whaleExit'].score} (prob=${(result.engines['whaleExit'].metadata?.exitProbability as number)?.toFixed(1) ?? '?'}%)`);
    console.log(`  Smart Money Flow: signal=${result.engines['smartMoneyFlow'].signal} (score=${result.engines['smartMoneyFlow'].score})`);
    console.log(`  Chief AI: action=${result.chiefAI.action}, confidence=${result.chiefAI.confidence.toFixed(0)}%`);
    console.log(`  Analyst: score=${result.analyst.score}, confidence=${result.analyst.confidence.toFixed(0)}%, consensus=${result.analyst.consensusSignal}`);

    if (result.failed.length > 0) {
      console.log(`  ⚠ Failures:`);
      for (const f of result.failed) {
        console.log(`    - ${f}`);
      }
    }
    console.log();
  }

  // Summary
  console.log('═'.repeat(100));
  console.log('  OVERALL RESULTS');
  console.log('═'.repeat(100));
  console.log(`  Scenarios: ${results.length}`);
  console.log(`  Total checks: ${totalPassed + totalFailed}`);
  console.log(`  Passed: ${totalPassed} (${(totalPassed / (totalPassed + totalFailed) * 100).toFixed(1)}%)`);
  console.log(`  Failed: ${totalFailed} (${(totalFailed / (totalPassed + totalFailed) * 100).toFixed(1)}%)`);
  console.log(`  Average scenario score: ${(results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(0)}%`);
  console.log();

  console.log('  Per-Scenario Scores:');
  for (const r of results) {
    const bar = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
    console.log(`  [${bar}] ${r.scenario.padEnd(25)} ${r.score}% (${r.passed.length}/${r.passed.length + r.failed.length})`);
  }
  console.log();

  // Detailed analysis
  console.log('═'.repeat(100));
  console.log('  ENGINE-LEVEL ACCURACY');
  console.log('═'.repeat(100));

  const engineNames = ['marketRegime', 'poolActivity', 'marketPsychology', 'accumulation', 'whaleExit', 'smartMoneyFlow', 'chiefAI'];
  const engineLabels = ['Market Regime', 'Pool Activity', 'Psychology', 'Accumulation', 'Whale Exit', 'SM Flow', 'Chief AI'];

  for (let ei = 0; ei < engineNames.length; ei++) {
    const name = engineNames[ei];
    const label = engineLabels[ei];
    const passCount = results.filter(r => r.passed.includes(name)).length;
    const failCount = results.filter(r => r.failed.some(f => f.startsWith(name))).length;
    const rate = (passCount / (passCount + failCount) * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(Number(rate) / 10)) + '░'.repeat(10 - Math.round(Number(rate) / 10));
    console.log(`  [${bar}] ${label.padEnd(18)} ${rate}% (${passCount}/${passCount + failCount})`);
  }
  console.log();

  console.log('  Engine Output Ranges:');
  for (const r of results) {
    console.log(`  ${r.scenario.padEnd(22)}:`, Object.entries(r.engines).map(([k, v]) => `${k}=${v.score}`).join(', '));
  }
  console.log();

  // Write structured JSON for report generation
  const fs = await import('fs/promises');
  await fs.writeFile('scripts/paper_trading_results.json', JSON.stringify(results, null, 2));
  console.log('  Results saved to scripts/paper_trading_results.json');
  console.log();
})();
