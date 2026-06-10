import { writeFileSync, appendFileSync } from 'fs';
import { config } from 'dotenv';
config();

const DEBUG_LOG = 'repository_trace.log';
const REPORT_FILE = 'PHASE58_ROOT_CAUSE.md';

function log(msg: string) {
  const now = new Date().toISOString();
  appendFileSync(DEBUG_LOG, `[${now}] ${msg}\n`, 'utf-8');
  process.stdout.write(msg + '\n');
}

function safeFetch(url: string, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown; text: string; error?: string }> {
  return (async () => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      const text = await res.text();
      const body = text ? safeJson(text) : null;
      return { ok: res.ok, status: res.status, body, text, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return { ok: false, status: 0, body: null, text: '', error: err.stack || err.message };
    }
  })();
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

const FLOW: string[] = [];

function mark(stage: string, status: 'START' | 'SUCCESS' | 'FAILURE', detail = '') {
  const line = `[FLOW] ${stage} → ${status}${detail ? ' : ' + detail : ''}`;
  FLOW.push(line);
  log(line);
}

async function discoverPools(): Promise<Array<{ pool: string; mint: string }>> {
  mark('discoverPools', 'START');
  const { readFileSync, existsSync } = await import('fs');
  const addrs = new Set<string>();
  for (const p of ['/root/.pm2/logs/meridian-out.log', './meridian-out.log']) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/\[LPIntelligence\] Evaluating pool (\S+)/);
      if (m) addrs.add(m[1]);
      const m2 = line.match(/Indicator rejected .+ \((\S+)\):/);
      if (m2) addrs.add(m2[1]);
    }
  }
  log(`  Found ${addrs.size} raw pool addresses`);

  const results: Array<{ pool: string; mint: string }> = [];
  for (const addr of addrs) {
    if (results.length >= 3) break;
    log(`  Fetching metadata for ${addr.slice(0, 12)}...`);
    const url = `https://pool-discovery-api.datapi.meteora.ag/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${addr}`)}&timeframe=5m`;
    const r = await safeFetch(url);
    if (!r.ok) { log(`    SKIP — fetch failed: ${r.error}`); continue; }
    const pool = (r.body as Record<string, unknown>)?.data?.[0] as Record<string, unknown> | undefined;
    if (!pool) { log(`    SKIP — no pool data`); continue; }
    const tx = (pool.token_x || pool.tokenX || {}) as Record<string, unknown>;
    const mint = (tx.address || tx.mint || '') as string;
    if (mint && mint !== 'So11111111111111111111111111111111111111112') {
      results.push({ pool: addr, mint });
      log(`    OK — ${tx.symbol || '?'} mint=${mint.slice(0, 12)}...`);
    }
  }
  log(`  Valid alt pools: ${results.length}`);
  mark('discoverPools', 'SUCCESS', `${results.length} pools`);
  return results;
}

function flowReport(): string {
  const lines = ['## Execution Flow', '', '```'];
  for (const f of FLOW) lines.push(f);
  lines.push('```', '');
  return lines.join('\n');
}

async function traceFullSync(mint: string, poolAddr: string) {
  const results: string[] = [];
  const { repositories } = await import('../dist/repositories/index.js');

  // ─────────────────────────────────────────────────────────
  // STAGE 1: Token sync
  // ─────────────────────────────────────────────────────────
  mark('fullSync.token', 'START', mint.slice(0, 12));
  results.push('### Token Sync');
  results.push('');

  const birdeyeKey = process.env.BIRDEYE_API_KEY;
  const jupKey = process.env.JUPITER_API_KEY;
  const bdHeaders = birdeyeKey ? { 'x-api-key': birdeyeKey, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

  // 1a. Birdeye token overview
  mark('token.birdeye', 'START');
  const bdRes = await safeFetch(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, bdHeaders);
  if (!bdRes.ok) {
    mark('token.birdeye', 'FAILURE', bdRes.error || `HTTP ${bdRes.status}`);
    results.push(`- Birdeye: ❌ ${bdRes.error}`);
  } else {
    mark('token.birdeye', 'SUCCESS');
    results.push(`- Birdeye: ✅ HTTP ${bdRes.status}`);
    const body = bdRes.body as Record<string, unknown> | null;
    if (body) {
      results.push(`  - Root keys: ${Object.keys(body).join(', ')}`);
      if (body.data && typeof body.data === 'object') {
        results.push(`  - Nested data keys: ${Object.keys(body.data as Record<string, unknown>).join(', ')}`);
        const d = body.data as Record<string, unknown>;
        results.push(`  - symbol: ${d.symbol ?? 'undefined'}`);
        results.push(`  - name: ${d.name ?? 'undefined'}`);
        results.push(`  - price: ${d.price ?? 'undefined'}`);
        results.push(`  - marketCap: ${d.marketCap ?? 'undefined'}`);
        results.push(`  - liquidity: ${d.liquidity ?? 'undefined'}`);
        results.push(`  - holders: ${d.holders ?? 'undefined'}`);
      }
    }
  }

  // 1b. Jupiter token info
  mark('token.jupiter', 'START');
  const jupRes = await safeFetch(`https://tokens.jup.ag/token/${mint}`);
  if (!jupRes.ok) {
    mark('token.jupiter', 'FAILURE', jupRes.error || `HTTP ${jupRes.status}`);
    results.push(`- Jupiter: ❌ ${jupRes.error}`);
  } else {
    mark('token.jupiter', 'SUCCESS');
    results.push(`- Jupiter: ✅ HTTP ${jupRes.status}`);
    const jbody = jupRes.body as Record<string, unknown> | null;
    if (jbody) {
      results.push(`  - symbol: ${jbody.symbol ?? 'undefined'}`);
      results.push(`  - price: ${jbody.price ?? 'undefined'}`);
    }
  }

  // 1c. Mapper
  mark('token.mapper', 'START');
  const birdeyeData = bdRes.ok ? bdRes.body : null;
  const jupData = jupRes.ok ? jupRes.body : null;

  const tokenObj = {
    mint,
    symbol: (birdeyeData as Record<string, unknown>)?.symbol
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.symbol
      ?? (jupData as Record<string, unknown>)?.symbol
      ?? 'UNKNOWN',
    name: (birdeyeData as Record<string, unknown>)?.name
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.name
      ?? (jupData as Record<string, unknown>)?.name
      ?? 'Unknown',
    decimals: (birdeyeData as Record<string, unknown>)?.decimals
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.decimals
      ?? (jupData as Record<string, unknown>)?.decimals
      ?? 6,
    supply: 0,
    price: (birdeyeData as Record<string, unknown>)?.price
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.price
      ?? (jupData as Record<string, unknown>)?.price
      ?? 0,
    marketCap: (birdeyeData as Record<string, unknown>)?.marketCap
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.marketCap
      ?? (jupData as Record<string, unknown>)?.marketCap
      ?? 0,
    liquidity: (birdeyeData as Record<string, unknown>)?.liquidity
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.liquidity
      ?? (jupData as Record<string, unknown>)?.liquidity
      ?? 0,
    volume24h: (birdeyeData as Record<string, unknown>)?.volume24h
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.volume24h
      ?? 0,
    holders: (birdeyeData as Record<string, unknown>)?.holders
      ?? ((birdeyeData as Record<string, unknown>)?.data as Record<string, unknown>)?.holders
      ?? (jupData as Record<string, unknown>)?.holders
      ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  results.push(`- Mapper output:`);
  results.push(`  - symbol=${tokenObj.symbol} name=${tokenObj.name}`);
  results.push(`  - price=${tokenObj.price} mcap=${tokenObj.marketCap} liq=${tokenObj.liquidity} holders=${tokenObj.holders}`);
  mark('token.mapper', 'SUCCESS');

  // 1d. Repository validate
  mark('token.validate', 'START');
  const tokenValidation = repositories.token.validate(tokenObj);
  results.push(`- Validation: ${tokenValidation.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (!tokenValidation.valid) {
    results.push(`  - Errors: ${tokenValidation.errors.join(', ')}`);
  }
  if (tokenValidation.warnings.length > 0) {
    results.push(`  - Warnings: ${tokenValidation.warnings.join(', ')}`);
  }
  mark('token.validate', tokenValidation.valid ? 'SUCCESS' : 'FAILURE');

  // 1e. Before save
  mark('token.beforeSave', 'START');
  const tokenBefore = await repositories.token.getByMint(mint);
  results.push(`- Before save: ${tokenBefore ? '✅ EXISTS' : '❌ null'}`);
  mark('token.beforeSave', 'SUCCESS');

  // 1f. Save
  mark('token.save', 'START');
  try {
    await repositories.token.upsert(tokenObj);
    results.push(`- upsert(): ✅ SUCCESS`);
    mark('token.save', 'SUCCESS');
  } catch (e) {
    const errMsg = e instanceof Error ? `${e.message}\n  ${e.stack?.split('\n').slice(1, 3).join('\n  ') || ''}` : String(e);
    results.push(`- upsert(): ❌ FAILED — ${errMsg}`);
    mark('token.save', 'FAILURE', e instanceof Error ? e.message : String(e));
  }

  // 1g. After save
  mark('token.afterSave', 'START');
  const tokenAfter = await repositories.token.getByMint(mint);
  results.push(`- After save: ${tokenAfter ? '✅ EXISTS' : '❌ null'}`);
  if (tokenAfter) {
    results.push(`  - symbol=${tokenAfter.symbol} price=${tokenAfter.price}`);
    results.push(`  - marketCap=${tokenAfter.marketCap} liquidity=${tokenAfter.liquidity}`);
  } else {
    // Direct map inspection
    const map = (repositories.token as unknown as { tokens: Map<string, unknown> }).tokens;
    results.push(`  - tokens Map size: ${map.size}`);
    results.push(`  - has mint key: ${map.has(mint)}`);
    if (map.has(mint)) {
      results.push(`  - Map entry: ${JSON.stringify(map.get(mint), null, 2).slice(0, 200)}`);
    }
  }
  mark('token.afterSave', tokenAfter ? 'SUCCESS' : 'FAILURE');

  // ─────────────────────────────────────────────────────────
  // STAGE 2: Holders sync
  // ─────────────────────────────────────────────────────────
  mark('fullSync.holders', 'START', mint.slice(0, 12));
  results.push('');
  results.push('### Holders Sync');

  mark('holders.birdeye', 'START');
  const hldRes = await safeFetch(`https://public-api.birdeye.so/defi/token_holders?address=${mint}&limit=100`, bdHeaders);
  if (!hldRes.ok) {
    mark('holders.birdeye', 'FAILURE', hldRes.error || `HTTP ${hldRes.status}`);
    results.push(`- Birdeye holders: ❌ ${hldRes.error}`);
  } else {
    mark('holders.birdeye', 'SUCCESS');
    const hBody = hldRes.body as Record<string, unknown> | null;
    const holderList: Array<unknown> = hBody?.data?.holders || hBody?.holders || [];
    results.push(`- Holders returned: ${holderList.length}`);
    if (holderList.length > 0) {
      const first = holderList[0] as Record<string, unknown>;
      results.push(`  - First: ${first.address?.toString().slice(0, 12)}... balance=${first.balance} pct=${first.percentage}`);
    }
  }

  mark('holders.save', 'START');
  const holdersArr = ((hldRes.body as Record<string, unknown>)?.data as Record<string, unknown>)?.holders as Array<Record<string, unknown>> | undefined;
  if (holdersArr && holdersArr.length > 0) {
    const hData = holdersArr.map((h: Record<string, unknown>) => ({
      address: h.address as string,
      tokenMint: mint,
      balance: Number(h.balance || 0),
      percentage: Number(h.percentage || 0),
      firstSeen: new Date(),
      lastSeen: new Date(),
      transactionCount: 0,
      tags: (h.tags as string[]) || [],
    }));
    try {
      const count = await repositories.holder.bulkUpsert(hData);
      results.push(`- Holder bulkUpsert: ${count}/${hData.length} saved`);
      mark('holders.save', 'SUCCESS', `${count} saved`);
    } catch (e) {
      results.push(`- Holder save: ❌ ${e instanceof Error ? e.message : String(e)}`);
      mark('holders.save', 'FAILURE', e instanceof Error ? e.message : String(e));
    }
  } else {
    results.push(`- No holders to save`);
    mark('holders.save', 'SKIP', 'no holders returned');
  }

  // Verify holder repo
  const savedHolders = repositories.holder.getTopHolders(mint, 5);
  results.push(`- Holder repo getTopHolders: ${savedHolders.length} entries`);

  // ─────────────────────────────────────────────────────────
  // STAGE 3: Transactions sync
  // ─────────────────────────────────────────────────────────
  mark('fullSync.transactions', 'START', mint.slice(0, 12));
  results.push('');
  results.push('### Transactions Sync');

  mark('txs.birdeye', 'START');
  const txRes = await safeFetch(`https://public-api.birdeye.so/defi/txs/token?address=${mint}&limit=100`, bdHeaders);
  if (!txRes.ok) {
    mark('txs.birdeye', 'FAILURE', txRes.error || `HTTP ${txRes.status}`);
    results.push(`- Birdeye txs: ❌ ${txRes.error}`);
  } else {
    mark('txs.birdeye', 'SUCCESS');
    const tBody = txRes.body as Record<string, unknown> | null;
    const txList: Array<unknown> = tBody?.data?.txns || tBody?.txns || [];
    results.push(`- Transactions returned: ${txList.length}`);
  }
  results.push('');

  // ─────────────────────────────────────────────────────────
  // STAGE 4: Market data sync
  // ─────────────────────────────────────────────────────────
  mark('fullSync.market', 'START', poolAddr.slice(0, 12));
  results.push('### Market Data Sync');

  // 4a. Birdeye market data
  mark('market.birdeye', 'START');
  const mktRes = await safeFetch(`https://public-api.birdeye.so/defi/token_market_data?address=${mint}`, bdHeaders);
  if (!mktRes.ok) {
    mark('market.birdeye', 'FAILURE', mktRes.error || `HTTP ${mktRes.status}`);
    results.push(`- Birdeye market: ❌ ${mktRes.error}`);
  } else {
    mark('market.birdeye', 'SUCCESS');
    results.push(`- Birdeye market: ✅ HTTP ${mktRes.status}`);
  }

  // 4b. DexScreener
  mark('market.dexscreener', 'START');
  const dsRes = await safeFetch(`https://api.dexscreener.com/latest/dex/search?q=${poolAddr}`);
  if (!dsRes.ok) {
    mark('market.dexscreener', 'FAILURE', dsRes.error || `HTTP ${dsRes.status}`);
    results.push(`- DexScreener: ❌ ${dsRes.error}`);
  } else {
    mark('market.dexscreener', 'SUCCESS');
    const dsBody = dsRes.body as Record<string, unknown> | null;
    const pairs = dsBody?.pairs as Array<unknown> | undefined;
    results.push(`- DexScreener: ✅ HTTP ${dsRes.status} pairs=${pairs?.length ?? 0}`);
  }

  // 4c. Mapper + validate + save
  const bd = mktRes.ok ? mktRes.body : null;
  const ds = dsRes.ok ? ((dsRes.body as Record<string, unknown>)?.pairs as Array<Record<string, unknown>>)?.[0] : null;

  const marketObj = {
    poolAddress: poolAddr,
    tokenMint: mint,
    price: (bd as Record<string, unknown>)?.price ?? ((bd as Record<string, unknown>)?.data as Record<string, unknown>)?.price ?? 0,
    volume5m: (bd as Record<string, unknown>)?.volume5m ?? ((bd as Record<string, unknown>)?.data as Record<string, unknown>)?.volume5m ?? 0,
    volume15m: 0,
    volume30m: 0,
    volume1h: 0,
    volume24h: 0,
    txCount5m: (bd as Record<string, unknown>)?.txCount5m ?? ds?.txCount?.m5 ?? 0,
    txCount15m: 0,
    txCount30m: 0,
    txCount1h: ds?.txCount?.h1 ?? 0,
    buyVolume5m: 0,
    sellVolume5m: 0,
    buyCount5m: 0,
    sellCount5m: 0,
    uniqueTraders5m: 0,
    uniqueTraders15m: 0,
    uniqueTraders1h: 0,
    uniqueTraders4h: 0,
    timestamp: new Date(),
  };

  mark('market.validate', 'START');
  const mktValidation = repositories.market.validate(marketObj);
  results.push(`- Market validation: ${mktValidation.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (!mktValidation.valid) results.push(`  - Errors: ${mktValidation.errors.join(', ')}`);
  mark('market.validate', mktValidation.valid ? 'SUCCESS' : 'FAILURE');

  mark('market.beforeSave', 'START');
  const mktBefore = await repositories.market.getLatest(poolAddr);
  results.push(`- Before save: ${mktBefore ? '✅ EXISTS' : '❌ null'}`);
  mark('market.beforeSave', 'SUCCESS');

  mark('market.save', 'START');
  try {
    await repositories.market.add(marketObj);
    results.push(`- market.add(): ✅ SUCCESS`);
    mark('market.save', 'SUCCESS');
  } catch (e) {
    const errMsg = e instanceof Error ? `${e.message}\n  ${e.stack?.split('\n').slice(1, 3).join('\n  ') || ''}` : String(e);
    results.push(`- market.add(): ❌ FAILED — ${errMsg}`);
    mark('market.save', 'FAILURE', e instanceof Error ? e.message : String(e));
  }

  mark('market.afterSave', 'START');
  const mktAfter = await repositories.market.getLatest(poolAddr);
  results.push(`- After save: ${mktAfter ? '✅ EXISTS' : '❌ null'}`);
  if (!mktAfter) {
    const snaps = (repositories.market as unknown as { snapshots: Array<Record<string, unknown>> }).snapshots;
    results.push(`  - snapshots array length: ${snaps.length}`);
    if (snaps.length > 0) {
      const last = snaps[snaps.length - 1];
      results.push(`  - last entry poolAddress=${last.poolAddress?.toString().slice(0, 12)}...`);
    }
  }
  mark('market.afterSave', mktAfter ? 'SUCCESS' : 'FAILURE');

  // ─────────────────────────────────────────────────────────
  // STAGE 5: Liquidity sync
  // ─────────────────────────────────────────────────────────
  mark('fullSync.liquidity', 'START', poolAddr.slice(0, 12));
  results.push('');
  results.push('### Liquidity Sync');

  mark('liquidity.meteora', 'START');
  const metRes = await safeFetch(`https://dlmm-api.meteora.ag/pair/${poolAddr}`);
  if (!metRes.ok) {
    mark('liquidity.meteora', 'FAILURE', metRes.error || `HTTP ${metRes.status}`);
    results.push(`- Meteora pool: ❌ ${metRes.error}`);
  } else {
    mark('liquidity.meteora', 'SUCCESS');
    const mBody = metRes.body as Record<string, unknown> | null;
    results.push(`- Meteora pool: ✅ HTTP ${metRes.status}`);
    results.push(`  - mintX: ${(mBody?.mintX as string || '?').slice(0, 12)}`);
    results.push(`  - liquidityX=${mBody?.liquidityX} liquidityY=${mBody?.liquidityY}`);
    results.push(`  - tvl=${mBody?.tvl}`);

    const liqSnapshot = {
      poolAddress: poolAddr,
      tokenMint: (mBody?.mintX as string) || '',
      liquidity: Number(mBody?.liquidityX || 0) + Number(mBody?.liquidityY || 0),
      tvl: Number(mBody?.tvl || 0),
      activeBinLiquidity: 0,
      timestamp: new Date(),
      source: 'meteora' as const,
    };

    mark('liquidity.validate', 'START');
    const liqVal = repositories.liquidity.validate(liqSnapshot);
    results.push(`- Liquidity validation: ${liqVal.valid ? '✅ PASS' : '❌ FAIL'}`);
    if (!liqVal.valid) results.push(`  - Errors: ${liqVal.errors.join(', ')}`);
    mark('liquidity.validate', liqVal.valid ? 'SUCCESS' : 'FAILURE');

    mark('liquidity.beforeSave', 'START');
    const liqBefore = await repositories.liquidity.getLatest(poolAddr);
    results.push(`- Before save: ${liqBefore ? '✅ EXISTS' : '❌ null'}`);
    mark('liquidity.beforeSave', 'SUCCESS');

    mark('liquidity.save', 'START');
    try {
      await repositories.liquidity.add(liqSnapshot);
      results.push(`- liquidity.add(): ✅ SUCCESS (liquidity=${liqSnapshot.liquidity} tvl=${liqSnapshot.tvl})`);
      mark('liquidity.save', 'SUCCESS');
    } catch (e) {
      const errMsg = e instanceof Error ? `${e.message}\n  ${e.stack?.split('\n').slice(1, 3).join('\n  ') || ''}` : String(e);
      results.push(`- liquidity.add(): ❌ FAILED — ${errMsg}`);
      mark('liquidity.save', 'FAILURE', e instanceof Error ? e.message : String(e));
    }

    mark('liquidity.afterSave', 'START');
    const liqAfter = await repositories.liquidity.getLatest(poolAddr);
    results.push(`- After save: ${liqAfter ? '✅ EXISTS' : '❌ null'}`);
    if (liqAfter) {
      results.push(`  - liquidity=${liqAfter.liquidity} tvl=${liqAfter.tvl}`);
    } else {
      const snaps = (repositories.liquidity as unknown as { snapshots: Array<Record<string, unknown>> }).snapshots;
      results.push(`  - snapshots array length: ${snaps.length}`);
      if (snaps.length > 0) {
        const last = snaps[snaps.length - 1];
        results.push(`  - last entry: poolAddress=${last.poolAddress?.toString().slice(0, 12)}...`);
      } else {
        results.push(`  - snapshots array is EMPTY — add() did not push`);
      }
    }
    mark('liquidity.afterSave', liqAfter ? 'SUCCESS' : 'FAILURE');
  }

  return results.join('\n');
}

async function main() {
  appendFileSync(DEBUG_LOG, `\n${'='.repeat(80)}\n  REPOSITORY TRACE START — ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`, 'utf-8');
  process.stdout.write('\n══════════════════════════════════════════════════════\n');
  process.stdout.write('  PHASE 58 — REPOSITORY POPULATION ROOT CAUSE\n');
  process.stdout.write('══════════════════════════════════════════════════════\n\n');

  log(`BIRDEYE_API_KEY: ${process.env.BIRDEYE_API_KEY ? '✅ set' : '❌ missing'}`);
  log(`JUPITER_API_KEY: ${process.env.JUPITER_API_KEY ? '✅ set' : '❌ missing'}`);
  log(`Node version: ${process.version}`);

  const pools = await discoverPools();
  if (pools.length === 0) {
    log('❌ No valid alt pools found — cannot trace repository population');
    generateReport([], []);
    return;
  }

  const allStageResults: string[] = [];
  let anyStageFailed = false;

  for (let i = 0; i < Math.min(pools.length, 3); i++) {
    const { pool, mint } = pools[i];
    mark('tracePool', 'START', `pool ${i + 1}/${Math.min(pools.length, 3)} — ${mint.slice(0, 12)}`);

    log(`\n${'█'.repeat(70)}`);
    log(`████  POOL ${i + 1}: ${mint.slice(0, 12)}... (pool: ${pool.slice(0, 12)}...)`);
    log(`${'█'.repeat(70)}`);

    const stageResult = await traceFullSync(mint, pool);
    allStageResults.push(stageResult);

    mark('tracePool', 'SUCCESS', `pool ${i + 1} done`);
  }

  // Check if any stage had FAILURE
  const failures = FLOW.filter(l => l.includes('FAILURE'));
  anyStageFailed = failures.length > 0;

  generateReport(allStageResults, pools);
}

function generateReport(stageResults: string[], pools: Array<{ pool: string; mint: string }>) {
  const failures = FLOW.filter(l => l.includes('FAILURE'));
  const tokenSaveFailures = FLOW.filter(l => l.includes('token.save') && l.includes('FAILURE'));
  const marketSaveFailures = FLOW.filter(l => l.includes('market.save') && l.includes('FAILURE'));
  const liqSaveFailures = FLOW.filter(l => l.includes('liquidity.save') && l.includes('FAILURE'));
  const tokenAfterNull = FLOW.filter(l => l.includes('token.afterSave') && l.includes('FAILURE'));
  const marketAfterNull = FLOW.filter(l => l.includes('market.afterSave') && l.includes('FAILURE'));
  const liqAfterNull = FLOW.filter(l => l.includes('liquidity.afterSave') && l.includes('FAILURE'));

  const lines: string[] = [];
  lines.push('# Phase 58 — Repository Population Root Cause');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Pools tested:** ${pools.length}`);
  lines.push('');

  lines.push('## Flow Summary');
  lines.push('');
  lines.push(flowReport());
  lines.push('');

  lines.push('## Per-Stage Results');
  lines.push('');
  lines.push('| Stage | Status |');
  lines.push('|---|---|');
  lines.push(`| Token save | ${tokenSaveFailures.length > 0 ? '❌ FAIL' : '✅ OK'} |`);
  lines.push(`| Token afterSave | ${tokenAfterNull.length > 0 ? '❌ NULL/empty' : '✅ OK'} |`);
  lines.push(`| Market save | ${marketSaveFailures.length > 0 ? '❌ FAIL' : '✅ OK'} |`);
  lines.push(`| Market afterSave | ${marketAfterNull.length > 0 ? '❌ NULL/empty' : '✅ OK'} |`);
  lines.push(`| Liquidity save | ${liqSaveFailures.length > 0 ? '❌ FAIL' : '✅ OK'} |`);
  lines.push(`| Liquidity afterSave | ${liqAfterNull.length > 0 ? '❌ NULL/empty' : '✅ OK'} |`);
  lines.push(`| Total failures | ${failures.length} |`);
  lines.push('');

  lines.push('## Stage Details');
  lines.push('');
  for (const s of stageResults) {
    lines.push(s);
    lines.push('');
  }

  // Identify exact failure point
  lines.push('## Root Cause Analysis');
  lines.push('');

  const firstFailure = FLOW.find(l => l.includes('FAILURE'));
  if (firstFailure) {
    lines.push(`**First failure detected:** ${firstFailure}`);
    lines.push('');

    if (tokenSaveFailures.length > 0) {
      lines.push('### Token Save Failure');
      lines.push('');
      lines.push('The `token.upsert()` method either:');
      lines.push('1. Was never called (throw before reaching it)');
      lines.push('2. Threw during execution');
      lines.push('3. The repository `tokens` Map was mutated externally after save');
      lines.push('');

      // Check validation
      if (tokenAfterNull.length > 0) {
        lines.push('### Token After-Save Returns null');
        lines.push('');
        lines.push('Even though `upsert()` may have succeeded, `getByMint()` returns null.');
        lines.push('This means:');
        lines.push('1. `upsert()` stored the token under a different key than `mint`');
        lines.push('2. The cache layer expired before the read');
        lines.push('3. The tokens Map was cleared between save and read');
        lines.push('');
      }
    }

    if (marketSaveFailures.length > 0) {
      lines.push('### Market Save Failure');
      lines.push('');
      lines.push('`market.add()` may have thrown or the snapshot was pushed to an array');
      lines.push('that is not the same array that `getLatest()` reads from.');
      lines.push('Check if `snapshots` array length increases after `add()`.');
      lines.push('');
    }

    if (liqSaveFailures.length > 0 || liqAfterNull.length > 0) {
      lines.push('### Liquidity Save Failure');
      lines.push('');
      lines.push('`liquidity.add()` pushes to the `snapshots` array and invalidates cache.');
      lines.push('If the array is empty after add(), either:');
      lines.push('1. `add()` was never called');
      lines.push('2. `add()` threw before the push');
      lines.push('3. The `snapshots` array on the instance is different from the one `getLatest()` reads');
      lines.push('');
    }
  }

  if (failures.length === 0) {
    lines.push('**No failures detected** — all stages completed successfully.');
    lines.push('If repositories still show empty, check that the AI engines are using the SAME repository instances.');
    lines.push('');
  }

  writeFileSync(REPORT_FILE, lines.join('\n'), 'utf-8');
  log(`\n═════════════════════════════════════════════════`);
  log(`  Report: ${REPORT_FILE}`);
  log(`  Debug log: ${DEBUG_LOG}`);
  log(`═════════════════════════════════════════════════`);
}

main().catch(e => {
  const stack = e instanceof Error ? e.stack || e.message : String(e);
  log(`\n❌ FATAL: ${stack}`);
  log(`\nFull stack trace:\n${e instanceof Error ? e.stack || '' : ''}`);
  process.exit(1);
});
