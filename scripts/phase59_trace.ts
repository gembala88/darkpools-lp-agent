import { MarketDataService } from '../src/services/marketDataService.js';
import { repositories } from '../src/repositories/index.js';
import { LpAlphaScoreEngine } from '../src/engines/lpAlphaScoreEngine.js';
import { aiEngines } from '../src/ai/index.js';

type PoolInput = { poolAddress: string; tokenMint: string; tokenName?: string; tokenSymbol?: string; narrative?: string; activeBin?: number; lowerBin?: number; upperBin?: number; binStep?: number; marketCap?: number; tokenAgeHours?: number; activeLPs?: string[]; priceChanges?: number[] };
type EngineSnapshot = { name: string; params: Record<string, unknown> | undefined; inputAvailable: boolean; score: number; signal: string; reason: string; weight: number; contribution: number; metadata: Record<string, unknown> };

function repoSize(repo: any): number {
  const internal = (repo as any).tokens ?? (repo as any).holders ?? (repo as any).snapshots ?? (repo as any).transactions;
  if (internal instanceof Map) return internal.size;
  if (Array.isArray(internal)) return internal.length;
  if ((repo as any).tokens instanceof Map) return (repo as any).tokens.size;
  return -1;
}

async function traceRepoState(label: string): Promise<void> {
  const tokenAll = await repositories.token.getAll();
  const holderCount = (await repositories.holder.getByToken('_all_')).length;
  const liqLatest = await repositories.liquidity.getLatest('_probe_');
  const mktLatest = await repositories.market.getLatest('_probe_');
  const txCount = (await repositories.transaction.getByPool('_probe_', 1)).length;
}

function getReadableRepoStats(): Promise<Record<string, number | string>> {
  return Promise.resolve({
    token: (repositories.token as any).tokens?.size ?? 0,
    holder: (repositories.holder as any).holders?.size ?? 0,
    liquidity: (repositories.liquidity as any).snapshots?.length ?? 0,
    market: (repositories.market as any).snapshots?.length ?? 0,
    transaction: (repositories.transaction as any).transactions?.length ?? 0,
  });
}

async function tracePool(pool: PoolInput): Promise<void> {
  const divider = '='.repeat(90);
  const subDivider = '-'.repeat(90);

  console.log(`\n${divider}`);
  console.log(`POOL TRACE: ${pool.poolAddress}`);
  console.log(`TOKEN: ${pool.tokenMint} (${pool.tokenSymbol ?? '?'})`);
  console.log(`${divider}\n`);

  // ── 1. Repository State Before Sync ──
  console.log(`[1] REPOSITORY STATE (BEFORE SYNC)`);
  console.log(subDivider);
  const before = await getReadableRepoStats();
  for (const [k, v] of Object.entries(before)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log();

  // ── 2. Market Data Sync ──
  console.log(`[2] MARKET DATA SYNC (fullSync)`);
  console.log(subDivider);
  const mds = new MarketDataService();
  let syncResult: any = null;
  try {
    syncResult = await mds.fullSync(pool.tokenMint, pool.poolAddress);
    console.log(`  token:   ${syncResult.token !== null ? `OK (${syncResult.token.symbol})` : 'NULL'}`);
    console.log(`  holders: ${syncResult.holders > 0 ? `OK (${syncResult.holders})` : '0 (FAILED)'}`);
    console.log(`  txs:     ${syncResult.transactions > 0 ? `OK (${syncResult.transactions})` : '0 (FAILED)'}`);
    console.log(`  market:  ${syncResult.market !== null ? 'OK' : 'NULL'}`);
    console.log(`  liq:     ${syncResult.liquidity !== null ? `OK (tvl=${syncResult.liquidity.tvl})` : 'NULL'}`);
  } catch (e: any) {
    console.log(`  ERROR: ${e.message}`);
  }
  console.log();

  // ── 3. Repository State After Sync ──
  console.log(`[3] REPOSITORY STATE (AFTER SYNC)`);
  console.log(subDivider);
  const after = await getReadableRepoStats();
  for (const [k, v] of Object.entries(after)) {
    const beforeVal = (before as any)[k];
    const delta = typeof v === 'number' && typeof beforeVal === 'number' ? v - beforeVal : '';
    console.log(`  ${k.padEnd(20)} ${v}${delta !== '' ? ` (Δ+${delta})` : ''}`);
  }
  console.log();

  // ── 4. Alpha Engines ──
  console.log(`[4] ALPHA ENGINES (12 sub-engines)`);
  console.log(subDivider);
  const alphaWeights: Record<string, number> = {
    feeAprPrediction: 0.18, liquidityUtilization: 0.14, txMomentum: 0.09,
    capitalInflow: 0.09, liquidityStability: 0.09, smartMoney: 0.09,
    smartLP: 0.09, rangeEfficiency: 0.04, holderGrowth: 0.04,
    narrative: 0.03, risk: 0.02, lpMomentum: 0.10,
  };

  const alphaEngine = new LpAlphaScoreEngine();
  const alphaResult = await alphaEngine.evaluate({
    poolAddress: pool.poolAddress, tokenMint: pool.tokenMint,
    tokenName: pool.tokenName, tokenSymbol: pool.tokenSymbol,
    narrative: pool.narrative, activeBin: pool.activeBin,
    lowerBin: pool.lowerBin, upperBin: pool.upperBin,
    binStep: pool.binStep, marketCap: pool.marketCap,
    tokenAgeHours: pool.tokenAgeHours, activeLPs: pool.activeLPs,
    priceChanges: pool.priceChanges,
  });

  const cs = (alphaResult.metadata as any) as Record<string, number>;
  let rawScore = 0;
  const snapshots: EngineSnapshot[] = [];

  for (const [name, weight] of Object.entries(alphaWeights)) {
    const score = cs[name] ?? 0;
    const contribution = name === 'risk'
      ? (100 - score) * weight
      : score * weight;
    rawScore += contribution;
    snapshots.push({
      name, params: { poolAddress: pool.poolAddress, tokenMint: pool.tokenMint },
      inputAvailable: true, score, signal: score >= 70 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
      reason: '', weight, contribution,
      metadata: {},
    });
  }

  for (const s of snapshots) {
    console.log(`  ${s.name.padEnd(24)} score=${String(s.score).padStart(6)}  weight=${s.weight.toFixed(2)}  contrib=${s.contribution.toFixed(4)}  sig=${s.score >= 70 ? 'BULL' : s.score < 40 ? 'BEAR' : 'NEUT'}`);
  }
  console.log(`  ${''.padEnd(24)} ${''.padStart(6)}  ${''.padStart(8)}  RAW SCORE = ${rawScore.toFixed(4)}`);
  console.log(`  ${''.padEnd(24)} ${''.padStart(6)}  ${''.padStart(8)}  FINAL     = ${alphaResult.score.toFixed(4)}`);
  console.log(`  ${''.padEnd(24)} ${''.padStart(6)}  ${''.padStart(8)}  CONFIDENCE= ${cs.confidence ?? '?'}`);
  console.log(`  Reason: ${alphaResult.reason}`);
  console.log();

  // ── 5. AI Engines ──
  console.log(`[5] AI ENGINES (9 sub-engines + ensemble)`);
  console.log(subDivider);

  const aiResults: Array<{ engine: string; score: number; signal: string; reason: string; metadata: Record<string, unknown> }> = [];
  const aiEngineNames = ['marketRegime', 'poolActivity', 'accumulation', 'whaleExit', 'smartMoneyFlow', 'candleIntelligence', 'marketPsychology', 'selfLearning', 'deploymentMemory'];

  for (const name of aiEngineNames) {
    try {
      const engine = (aiEngines as any)[name];
      const params: Record<string, unknown> = { poolAddress: pool.poolAddress, tokenMint: pool.tokenMint, ...pool };
      if (name === 'deploymentMemory') {
        params.currentScore = alphaResult.score;
        params.marketRegime = 'RANGING';
      }
      const r = await engine.evaluate(params);
      const result = { engine: name, score: r.score, signal: r.signal === 'bullish' ? 'BULL' : r.signal === 'bearish' ? 'BEAR' : 'NEUT', reason: r.reason, metadata: r.metadata };
      aiResults.push({ engine: name, score: r.score, signal: r.signal, reason: r.reason, metadata: r.metadata });
      console.log(`  ${name.padEnd(24)} score=${String(r.score).padStart(6)}  sig=${result.signal}`);
      console.log(`  ${''.padEnd(24)} reason: ${r.reason.slice(0, 120)}`);
    } catch (e: any) {
      aiResults.push({ engine: name, score: 50, signal: 'neutral', reason: e.message, metadata: {} });
      console.log(`  ${name.padEnd(24)} score=${String(50).padStart(6)}  sig=NEUT  (ERROR: ${e.message.slice(0, 60)})`);
    }
    console.log();
  }

  // ── 6. Dynamic Weights ──
  console.log(`  DYNAMIC WEIGHTS (marketRegime=default RANGING)`);
  const dynResult = await aiEngines.dynamicWeight.evaluate({ marketRegime: 'RANGING', confidence: cs.confidence ?? 80 });
  const weights = dynResult.metadata?.weights as Record<string, number> ?? {};
  let totalW = 0;
  for (const [k, v] of Object.entries(weights)) {
    console.log(`    ${k.padEnd(24)} ${v.toFixed(4)}`);
    totalW += v;
  }
  console.log(`    ${''.padEnd(24)} SUM = ${totalW.toFixed(4)}`);
  console.log();

  // ── 7. Analyst Layer ──
  console.log(`  ANALYST LAYER`);
  const analystResult = await aiEngines.analyst.evaluate({
    engineResults: aiResults.map(r => ({ engine: r.engine, score: r.score, signal: r.signal, reason: r.reason, metadata: r.metadata })),
    weights,
  });
  console.log(`    weightedScore = ${(analystResult.metadata?.weightedScore as number)?.toFixed(4) ?? '?'}`);
  console.log(`    overallScore  = ${analystResult.score}`);
  console.log(`    confidence    = ${(analystResult.metadata?.confidence as number)?.toFixed(1) ?? '?'}`);
  console.log(`    consensus     = ${analystResult.metadata?.consensusSignal as string ?? '?'}`);
  console.log(`    reason: ${analystResult.reason.slice(0, 150)}`);
  console.log();

  // ── 8. Multi-Agent System ──
  console.log(`  MULTI-AGENT SYSTEM`);
  const agentResult = await aiEngines.multiAgent.evaluate({
    engineResults: aiResults.map(r => ({ engine: r.engine, score: r.score, signal: r.signal, reason: r.reason })),
  });
  console.log(`    score          = ${agentResult.score}`);
  console.log(`    consensus conf = ${(agentResult.metadata?.consensusConfidence as number)?.toFixed(1) ?? '?'}`);
  const opinions = agentResult.metadata?.opinions as Array<{ agent: string; score: number; confidence: number }> | undefined;
  if (opinions) {
    for (const o of opinions) {
      console.log(`    ${o.agent.padEnd(22)} score=${String(o.score).padStart(5)}  conf=${String(o.confidence).padStart(5)}`);
    }
  }
  console.log();

  // ── 9. Chief AI Decision ──
  console.log(`  CHIEF AI DECISION`);
  const chiefResult = await aiEngines.chiefAI.evaluate({
    analystResult: {
      overallScore: analystResult.score,
      confidence: analystResult.metadata?.confidence as number,
      weightedScore: analystResult.metadata?.weightedScore as number,
      consensusSignal: analystResult.metadata?.consensusSignal as string,
    },
    agentResult: { score: agentResult.score, metadata: agentResult.metadata },
    marketRegimeScore: aiResults.find(r => r.engine === 'marketRegime')?.score ?? 50,
    poolActivityScore: aiResults.find(r => r.engine === 'poolActivity')?.score ?? 50,
    whaleExitScore: aiResults.find(r => r.engine === 'whaleExit')?.score ?? 100,
    deploymentMemoryScore: aiResults.find(r => r.engine === 'deploymentMemory')?.score ?? 50,
    selfLearningScore: aiResults.find(r => r.engine === 'selfLearning')?.score ?? 50,
  });
  console.log(`    finalScore     = ${chiefResult.score}`);
  console.log(`    action         = ${(chiefResult.metadata as any)?.recommendation?.action ?? '?'}`);
  console.log(`    warnings       = ${((chiefResult.metadata as any)?.warnings ?? []).join('; ') || '(none)'}`);
  console.log(`    signal         = ${chiefResult.signal}`);
  console.log(`    reason: ${chiefResult.reason}`);
  console.log();

  // ── 10. Final Ensemble ──
  console.log(`[6] FINAL ENSEMBLE SUMMARY`);
  console.log(subDivider);
  console.log(`  LP Alpha Score:         ${alphaResult.score.toFixed(4)}`);
  console.log(`  AI Overall Score:       ${analystResult.score}`);
  console.log(`  AI Confidence:          ${(analystResult.metadata?.confidence as number)?.toFixed(1) ?? '?'}`);
  console.log(`  Multi-Agent Score:      ${agentResult.score}`);
  console.log(`  Chief AI Score:         ${chiefResult.score}`);
  console.log(`  Chief AI Action:        ${(chiefResult.metadata as any)?.recommendation?.action ?? '?'}`);
  console.log(`  Chief AI Warnings:      ${((chiefResult.metadata as any)?.warnings ?? []).join('; ') || '(none)'}`);
  console.log(`  Deployment Decision:    (requires noDeployFilter + positionSizing)`);
  console.log();

  // ── 11. Repository State Final ──
  console.log(`[7] REPOSITORY STATE (FINAL)`);
  console.log(subDivider);
  const final = await getReadableRepoStats();
  for (const [k, v] of Object.entries(final)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log();
}

// ── main ──
const testPools: PoolInput[] = [
  {
    poolAddress: '7c1WxW4m2sJ8yK7zYxGmJqX5nLsZqUqPpRvBqDqWqXqY',
    tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    tokenSymbol: 'USDC',
    tokenName: 'USD Coin',
    narrative: 'Stablecoin',
  },
];

const poolArg = process.argv.find(a => a.startsWith('--pool='));
const mintArg = process.argv.find(a => a.startsWith('--mint='));

if (poolArg && mintArg) {
  await tracePool({
    poolAddress: poolArg.split('=')[1],
    tokenMint: mintArg.split('=')[1],
  });
} else {
  for (const pool of testPools) {
    await tracePool(pool);
    console.log('\n\n');
  }
}

console.log('PHASE59 TRACE COMPLETE');
