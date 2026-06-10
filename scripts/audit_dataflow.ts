import { readFileSync, existsSync, writeFileSync } from 'fs';
import { LPIntelligenceService } from '../dist/services/lpIntelligenceService.js';

const POOL_DISCOVERY_API = 'https://pool-discovery-api.datapi.meteora.ag';

interface PoolMeta {
  address: string;
  name: string;
  tokenMint: string;
  symbol: string;
}

interface EngineDump {
  engine: string;
  score: number;
  signal: string;
  reason: string;
  metadata: Record<string, unknown>;
}

interface PoolAudit {
  pool: string;
  tokenMint: string;
  symbol: string;
  fullSyncResult: {
    token: unknown;
    holders: number;
    transactions: number;
    market: unknown;
    liquidity: unknown;
  } | null;
  alphaScore: number;
  alphaComponents: Record<string, number>;
  engines: EngineDump[];
}

async function fetchPoolMeta(poolAddress: string): Promise<PoolMeta | null> {
  try {
    const url = `${POOL_DISCOVERY_API}/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}&timeframe=5m`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json() as { data?: Array<Record<string, unknown>> };
    const pool = (body.data || [])[0] as Record<string, unknown> | undefined;
    if (!pool) return null;
    const tx = (pool.token_x || pool.tokenX || {}) as Record<string, unknown>;
    const mint = (tx.address || tx.mint || '') as string;
    if (!mint) return null;
    return {
      address: poolAddress,
      name: (pool.name || poolAddress) as string,
      tokenMint: mint,
      symbol: (tx.symbol || '?') as string,
    };
  } catch {
    return null;
  }
}

async function auditPool(lpIntelligence: LPIntelligenceService, poolAddr: string): Promise<PoolAudit | null> {
  const meta = await fetchPoolMeta(poolAddr);
  if (!meta) return null;
  if (meta.tokenMint === 'So11111111111111111111111111111111111111112') return null;

  process.stdout.write(`\n=== ${meta.symbol.padEnd(8)} ${poolAddr.slice(0, 12)}... ===\n`);

  // Step 1: Call fullSync directly and inspect result
  let fullSyncResult = null;
  try {
    // Access marketData through the service
    const marketData = (lpIntelligence as unknown as { marketData: { fullSync: Function } }).marketData;
    const syncResult = await marketData.fullSync(meta.tokenMint, poolAddr);
    process.stdout.write(`  fullSync: token=${syncResult.token ? 'OK' : 'NULL'}, holders=${syncResult.holders}, txs=${syncResult.transactions}, market=${syncResult.market ? 'OK' : 'NULL'}, liq=${syncResult.liquidity ? 'OK' : 'NULL'}\n`);
    fullSyncResult = syncResult;
  } catch (e) {
    process.stdout.write(`  fullSync ERROR: ${e}\n`);
  }

  // Step 2: Evaluate with LPIntelligenceService to get alpha + full result
  let alphaScore = 0;
  let alphaComps: Record<string, number> = {};
  const engineDumps: EngineDump[] = [];

  try {
    // Manually call each alpha sub-engine
    const alphaEngine = (lpIntelligence as unknown as { alphaEngine: { engines: Record<string, { evaluate: Function; name: string }>; evaluate: Function } }).alphaEngine;

    // Get component scores from alpha engine
    const alphaResult = await alphaEngine.evaluate({
      poolAddress: poolAddr,
      tokenMint: meta.tokenMint,
      tokenName: meta.name,
      tokenSymbol: meta.symbol,
      marketCap: 500000,
      tokenAgeHours: 24,
    });
    alphaScore = alphaResult.score;
    const meta2 = alphaResult.metadata || {};
    const comps = meta2.componentScores || meta2;
    if (typeof comps === 'object' && comps !== null) {
      alphaComps = comps as Record<string, number>;
    }
    process.stdout.write(`  alpha: score=${alphaScore.toFixed(2)} | confidence=${(alphaResult.metadata?.confidence as number)?.toFixed(1) ?? '?'}%\n`);

    // Print component breakdown
    process.stdout.write(`  components:\n`);
    for (const [key, val] of Object.entries(alphaComps)) {
      process.stdout.write(`    ${key.padEnd(22)} = ${(val as number).toFixed(2)}\n`);
    }

    // Call each AI engine individually (same as LPIntelligenceService does)
    const { aiEngines } = await import('../dist/ai/index.js');
    const engineCalls = [
      { engine: 'marketRegime',     fn: aiEngines.marketRegime.evaluate({ poolAddress: poolAddr, tokenMint: meta.tokenMint }) },
      { engine: 'poolActivity',     fn: aiEngines.poolActivity.evaluate({ poolAddress: poolAddr, tokenMint: meta.tokenMint }) },
      { engine: 'accumulation',     fn: aiEngines.accumulation.evaluate({ poolAddress: poolAddr, tokenMint: meta.tokenMint }) },
      { engine: 'whaleExit',        fn: aiEngines.whaleExit.evaluate({ poolAddress: poolAddr, tokenMint: meta.tokenMint }) },
      { engine: 'smartMoneyFlow',   fn: aiEngines.smartMoneyFlow.evaluate({ poolAddress: poolAddr, tokenMint: meta.tokenMint }) },
      { engine: 'candleIntelligence', fn: aiEngines.candleIntelligence.evaluate({ poolAddress: poolAddr, tokenMint: meta.tokenMint }) },
      { engine: 'marketPsychology', fn: aiEngines.marketPsychology.evaluate({ poolAddress: poolAddr, tokenMint: meta.tokenMint }) },
      { engine: 'selfLearning',     fn: aiEngines.selfLearning.evaluate({ poolAddress: poolAddr }) },
      { engine: 'deploymentMemory', fn: aiEngines.deploymentMemory.evaluate({ poolAddress: poolAddr, currentScore: alphaScore }) },
    ];

    const engineResults = await Promise.allSettled(
      engineCalls.map(async (ec) => {
        try {
          const r = await ec.fn;
          return { engine: ec.engine, ...r };
        } catch (e) {
          return { engine: ec.engine, score: 0, signal: 'error', reason: String(e), metadata: {} };
        }
      })
    );

    for (const r of engineResults) {
      if (r.status === 'fulfilled') {
        const v = r.value;
        engineDumps.push(v);
        const sig = (v.signal || '?').toString().padEnd(8);
        const sc = (v.score ?? 0).toString().padStart(6);
        const metaStr = JSON.stringify(v.metadata || {}).slice(0, 80);
        process.stdout.write(`  ${v.engine.padEnd(20)} score=${sc} signal=${sig} metadata=${metaStr}\n`);
      }
    }

    // Step 3: Call full LPIntelligenceService evaluation
    process.stdout.write(`  --- Full LPIntelligenceService.evaluatePool() ---\n`);
    const fullResult = await lpIntelligence.evaluatePool(poolAddr, meta.tokenMint, {
      tokenName: meta.name,
      tokenSymbol: meta.symbol,
      marketCap: 500000,
      tokenAgeHours: 24,
    });
    process.stdout.write(`  Final: alpha=${fullResult.lpAlphaScore.toFixed(2)} | chief=${fullResult.aiChiefRecommendation} | regime=${fullResult.aiMarketRegime} | whale=${fullResult.aiWhaleExitProbability}\n`);

  } catch (e) {
    process.stdout.write(`  ERROR: ${e}\n`);
  }

  return {
    pool: poolAddr,
    tokenMint: meta.tokenMint,
    symbol: meta.symbol,
    fullSyncResult: fullSyncResult ? {
      token: fullSyncResult.token ? 'present' : null,
      holders: fullSyncResult.holders,
      transactions: fullSyncResult.transactions,
      market: fullSyncResult.market ? 'present' : null,
      liquidity: fullSyncResult.liquidity ? 'present' : null,
    } : null,
    alphaScore,
    alphaComponents: alphaComps,
    engines: engineDumps,
  };
}

function discoverPoolAddresses(): string[] {
  const set = new Set<string>();
  const pm2LogPaths = [
    '/root/.pm2/logs/meridian-out.log',
    './meridian-out.log',
  ];
  for (const p of pm2LogPaths) {
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8');
    for (const line of content.split('\n')) {
      const evalMatch = line.match(/\[LPIntelligence\] Evaluating pool (\S+)/);
      if (evalMatch) set.add(evalMatch[1]);
      const rejectMatch = line.match(/Indicator rejected .+ \((\S+)\):/);
      if (rejectMatch) set.add(rejectMatch[1]);
    }
  }
  if (existsSync('decision-log.json')) {
    try {
      for (const line of readFileSync('decision-log.json', 'utf-8').trim().split('\n').filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.pool) set.add(e.pool);
      }
    } catch {}
  }
  return Array.from(set);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     LP INTELLIGENCE DATA FLOW AUDIT                ║');
  console.log('║     Per-engine raw output for 10 pools             ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const lpIntelligence = new LPIntelligenceService();
  const addresses = discoverPoolAddresses();
  console.log(`Discovered ${addresses.length} unique pool addresses\n`);

  const results: PoolAudit[] = [];
  let audited = 0;

  for (const addr of addresses) {
    if (audited >= 10) break;
    const r = await auditPool(lpIntelligence, addr);
    if (r) {
      results.push(r);
      audited++;
    }
  }

  // Analysis
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ANALYSIS');
  console.log('══════════════════════════════════════════════════════\n');

  const uniqueScores = new Set(results.map(r => r.alphaScore.toFixed(2)));
  const uniqueRegimes = new Set(results.flatMap(r => r.engines.filter(e => e.engine === 'marketRegime').map(e => (e.metadata?.regime as string) || '?')));
  const uniqueWhaleScores = new Set(results.flatMap(r => r.engines.filter(e => e.engine === 'whaleExit').map(e => (100 - e.score).toFixed(0))));

  console.log(`Pools audited: ${results.length}`);
  console.log(`Unique alpha scores: ${uniqueScores.size}`);
  console.log(`Unique regimes: ${uniqueRegimes.size}`);
  console.log(`Unique whale exit probs: ${uniqueWhaleScores.size}`);

  // Check if fullSync data is populated
  const allNull = results.every(r => {
    const fs = r.fullSyncResult;
    return fs && fs.token === null && fs.holders === 0 && fs.transactions === 0 && fs.market === null && fs.liquidity === null;
  });

  // Check if fullSync data varies
  const syncPatterns = new Set(results.map(r => {
    const fs = r.fullSyncResult;
    if (!fs) return 'ERROR';
    return `${fs.token ? 'T' : '_'}${fs.holders > 0 ? 'H' : '_'}${fs.transactions > 0 ? 'X' : '_'}${fs.market ? 'M' : '_'}${fs.liquidity ? 'L' : '_'}`;
  }));

  console.log(`\nfullSync patterns: ${[...syncPatterns].join(', ')}`);
  console.log(`All repositories empty: ${allNull ? 'YES' : 'NO'}`);

  // Check per-component variance
  const allComponents = new Set<string>();
  results.forEach(r => Object.keys(r.alphaComponents).forEach(k => allComponents.add(k)));

  console.log('\n── Component Variance ──');
  for (const comp of allComponents) {
    const vals = new Set(results.map(r => (r.alphaComponents[comp] ?? 0).toFixed(2)));
    console.log(`  ${comp.padEnd(22)} unique=${vals.size > 1 ? '✅' : '❌'} values=[${[...vals].join(', ')}]`);
  }

  console.log('\n── AI Engine Variance ──');
  for (const engine of ['marketRegime', 'poolActivity', 'accumulation', 'whaleExit', 'smartMoneyFlow', 'candleIntelligence', 'marketPsychology']) {
    const vals = new Set(results.flatMap(r => r.engines.filter(e => e.engine === engine).map(e => e.score.toFixed(2))));
    console.log(`  ${engine.padEnd(22)} unique=${vals.size > 1 ? '✅' : '❌'} scores=[${[...vals].join(', ')}]`);
  }

  // Root cause identification
  console.log('\n══ ROOT CAUSE ══');
  if (allNull) {
    console.log('fullSync returns null/empty for ALL pools → repositories are empty');
  }
  if (uniqueScores.size <= 1) {
    if (syncPatterns.size <= 1) {
      console.log('fullSync has identical result pattern for all pools → all engines get same input data');
      console.log('This means either:');
      console.log('  1. All API/RPC calls in fullSync are failing silently');
      console.log('  2. The repositories are not being populated despite successful fetches');
      console.log('  3. The data fetcher uses a shared API key that is exhausted/rate-limited');
    }
  }

  // Generate report
  const report = generateReport(results, allNull, uniqueScores.size <= 1, syncPatterns.size <= 1);
  writeFileSync('LP_INTELLIGENCE_DATAFLOW_REPORT.md', report, 'utf-8');
  console.log('\n  Report: LP_INTELLIGENCE_DATAFLOW_REPORT.md');
}

function generateReport(
  results: PoolAudit[],
  allEmpty: boolean,
  noScoreVariance: boolean,
  noSyncVariance: boolean
): string {
  const lines: string[] = [];
  lines.push('# LP Intelligence Data Flow Audit');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Pools audited:** ${results.length}`);
  lines.push('');

  lines.push('## Per-Pool Engine Output');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.symbol} — ${r.pool.slice(0, 16)}...`);
    lines.push('');
    lines.push(`**tokenMint:** \`${r.tokenMint}\``);
    lines.push(`**Alpha Score:** ${r.alphaScore.toFixed(2)}`);
    lines.push('');

    lines.push('| Engine | Score | Signal | Key Metadata |');
    lines.push('|---|---|---|---|');
    for (const e of r.engines) {
      const meta = JSON.stringify(e.metadata || {}).slice(0, 100);
      lines.push(`| ${e.engine} | ${e.score.toFixed(2)} | ${e.signal} | ${meta} |`);
    }
    lines.push('');

    lines.push('**Alpha Components:**');
    lines.push('');
    lines.push('| Component | Value |');
    lines.push('|---|---|');
    for (const [k, v] of Object.entries(r.alphaComponents)) {
      lines.push(`| ${k} | ${(v as number).toFixed(2)} |`);
    }
    lines.push('');

    lines.push('**fullSync Result:**');
    const fs = r.fullSyncResult;
    if (fs) {
      lines.push(`- token: ${fs.token || 'null'}, holders: ${fs.holders}, transactions: ${fs.transactions}`);
      lines.push(`- market: ${fs.market || 'null'}, liquidity: ${fs.liquidity || 'null'}`);
    } else {
      lines.push('- **ERROR** — fullSync threw');
    }
    lines.push('');
  }

  lines.push('## Cross-Pool Variance Analysis');
  lines.push('');
  if (noScoreVariance) {
    lines.push('❌ **No alpha score variance detected.**');
  } else {
    lines.push('✅ **Alpha score variance confirmed.**');
  }
  if (allEmpty) {
    lines.push('❌ **fullSync returned empty/null data for ALL pools.**');
  }
  if (noSyncVariance) {
    lines.push('❌ **fullSync result pattern is identical for ALL pools.**');
  }
  lines.push('');

  lines.push('## Root Cause');
  lines.push('');
  if (allEmpty && noSyncVariance) {
    lines.push('The `fullSync()` call in `marketDataService.ts` produces empty/null data for **every pool**.');
    lines.push('This means the in-memory repositories have no data, so all AI engines fall back to their default scores.');
    lines.push('');
    lines.push('Most likely causes:');
    lines.push('1. **RPC/API fetches fail silently** — `fullSync` uses `Promise.allSettled` and engines use `.catch(() => ...)`');
    lines.push('2. **Missing environment variables** — `RPC_URL`, `HELIUS_API_KEY`, or other API keys not available in ts-node context');
    lines.push('3. **Repository initialization** — Repositories may need initialization that only happens in production startup');
    lines.push('');
    lines.push('The consistent alpha score of ~7.5 is produced by the default fallback paths:');
    lines.push('- risk engine defaults to 50 (caught) → contributes `(100-50) * 0.02 = 1.0`');
    lines.push('- lpMomentum defaults to 50 (caught) → contributes `50 * 0.10 = 5.0`');
    lines.push('- Other engines returning 0 or their own defaults → contributes ~1.5');
    lines.push('- Total: ~7.5');
  } else {
    lines.push('Further investigation needed — partial data may be flowing.');
  }

  return lines.join('\n');
}

main().catch(console.error);
