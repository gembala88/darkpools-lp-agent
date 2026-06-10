import { writeFileSync, appendFileSync } from 'fs';
import { config } from 'dotenv';
config();

const DEBUG_LOG = 'repository_trace.log';

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(DEBUG_LOG, line + '\n', 'utf-8');
  process.stdout.write(msg + '\n');
}

function logBlock(title: string) {
  log(`\n${'='.repeat(70)}`);
  log(`  ${title}`);
  log(`${'='.repeat(70)}`);
}

async function httpJson(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

function extractNested(birdeyeBody: unknown, field: string): unknown {
  if (!birdeyeBody || typeof birdeyeBody !== 'object') return undefined;
  const obj = birdeyeBody as Record<string, unknown>;
  // Birdeye wraps in { success, data }
  if ('data' in obj && obj.data && typeof obj.data === 'object') {
    return (obj.data as Record<string, unknown>)[field];
  }
  // Direct access
  return obj[field];
}

async function traceTokenRepository(mint: string) {
  logBlock(`TOKEN REPOSITORY — mint=${mint.slice(0, 12)}...`);

  const birdeyeKey = process.env.BIRDEYE_API_KEY;
  const headers = birdeyeKey ? {
    'x-api-key': birdeyeKey,
    'Content-Type': 'application/json',
  } : { 'Content-Type': 'application/json' };

  // 1. Raw API response
  log('\n── 1. Raw API Response ──');
  const bdUrl = `https://public-api.birdeye.so/defi/token_overview?address=${mint}`;
  const bdRes = await httpJson(bdUrl, headers);
  log(`  URL: ${bdUrl}`);
  log(`  Status: ${bdRes.status}`);
  if (bdRes.status === 200) {
    log(`  Body keys: ${Object.keys(bdRes.body || {}).join(', ')}`);
    // Check if data is nested
    if (bdRes.body?.data) {
      log(`  Nested data keys: ${Object.keys(bdRes.body.data).join(', ')}`);
    }
  }

  const jupUrl = `https://tokens.jup.ag/token/${mint}`;
  const jupRes = await httpJson(jupUrl);
  log(`\n  Jupiter URL: ${jupUrl}`);
  log(`  Jupiter status: ${jupRes.status}`);
  if (jupRes.status === 200) log(`  Jupiter keys: ${Object.keys(jupRes.body || {}).join(', ')}`);
  else log(`  Jupiter error: ${jupRes.body}`);

  // 2. Mapper output
  log('\n── 2. Mapper Output (as marketDataService.ts constructs it) ──');

  const birdeyeData = bdRes.body;
  const jupData = jupRes.body;

  // Current mapping — reads directly from root
  const tokenCurrent = {
    mint,
    symbol: birdeyeData?.symbol ?? jupData?.symbol ?? 'UNKNOWN',
    name: birdeyeData?.name ?? jupData?.name ?? 'Unknown',
    decimals: birdeyeData?.decimals ?? jupData?.decimals ?? 6,
    supply: 0,
    price: birdeyeData?.price ?? jupData?.price ?? 0,
    marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0,
    liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0,
    volume24h: birdeyeData?.volume24h ?? 0,
    holders: birdeyeData?.holders ?? jupData?.holders ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  log(`  CURRENT mapping (root-level read):`);
  log(`    symbol=${tokenCurrent.symbol} name=${tokenCurrent.name}`);
  log(`    price=${tokenCurrent.price} marketCap=${tokenCurrent.marketCap} liquidity=${tokenCurrent.liquidity} holders=${tokenCurrent.holders}`);

  // Check if Birdeye nests data
  const birdeyeSymbolNested = extractNested(bdRes.body, 'symbol');
  const birdeyeMcapNested = extractNested(bdRes.body, 'marketCap');
  const birdeyeLiqNested = extractNested(bdRes.body, 'liquidity');

  log(`\n  Birdeye nested data check:`);
  log(`    symbol (nested) = ${birdeyeSymbolNested ?? 'undefined'}`);
  log(`    marketCap (nested) = ${birdeyeMcapNested ?? 'undefined'}`);
  log(`    liquidity (nested) = ${birdeyeLiqNested ?? 'undefined'}`);

  // 3. Validation layer
  log('\n── 3. Validation Layer ──');

  const { repositories } = await import('../dist/repositories/index.js');
  const validationCurrent = repositories.token.validate(tokenCurrent);
  log(`  CURRENT mapping validation: ${validationCurrent.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (!validationCurrent.valid) {
    log(`  Errors: ${validationCurrent.errors.join(', ')}`);
  }

  // Try with nested data extraction
  const tokenFixed = {
    mint,
    symbol: birdeyeSymbolNested as string ?? tokenCurrent.symbol,
    name: (extractNested(bdRes.body, 'name') as string) ?? tokenCurrent.name,
    decimals: (extractNested(bdRes.body, 'decimals') as number) ?? tokenCurrent.decimals,
    supply: (extractNested(bdRes.body, 'supply') as number) ?? 0,
    price: (extractNested(bdRes.body, 'price') as number) ?? tokenCurrent.price,
    marketCap: (birdeyeMcapNested as number) ?? tokenCurrent.marketCap,
    liquidity: (birdeyeLiqNested as number) ?? tokenCurrent.liquidity,
    volume24h: (extractNested(bdRes.body, 'volume24h') as number) ?? 0,
    holders: (extractNested(bdRes.body, 'holders') as number) ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const validationFixed = repositories.token.validate(tokenFixed);
  log(`\n  FIXED mapping (nested read) validation: ${validationFixed.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (!validationFixed.valid) {
    log(`  Errors: ${validationFixed.errors.join(', ')}`);
  } else {
    log(`  Fixed token: symbol=${tokenFixed.symbol} price=${tokenFixed.price} mcap=${tokenFixed.marketCap} liq=${tokenFixed.liquidity}`);
  }

  // 4. Before save
  log('\n── 4. Before Save ──');
  const before = await repositories.token.getByMint(mint);
  log(`  getByMint before save: ${before ? JSON.stringify({ symbol: before.symbol, price: before.price }) : 'null'}`);

  // 5. Save with CURRENT mapping
  log('\n── 5. Save (with current mapping) ──');
  try {
    const saved = await repositories.token.upsert(tokenCurrent);
    log(`  upsert returned: symbol=${saved.symbol} price=${saved.price}`);
  } catch (e) {
    log(`  upsert THREW: ${e}`);
  }

  // 6. After save read
  log('\n── 6. After Save Read ──');
  const after = await repositories.token.getByMint(mint);
  log(`  getByMint after save: ${after ? JSON.stringify({ symbol: after.symbol, price: after.price, marketCap: after.marketCap, liquidity: after.liquidity, holders: after.holders }) : 'null'}`);

  return { tokenCurrent, tokenFixed, validationCurrent, validationFixed, after };
}

async function traceMarketRepository(poolAddress: string, mint: string) {
  logBlock(`MARKET REPOSITORY — pool=${poolAddress.slice(0, 12)}...`);

  const birdeyeKey = process.env.BIRDEYE_API_KEY;
  const headers = birdeyeKey ? {
    'x-api-key': birdeyeKey,
    'Content-Type': 'application/json',
  } : { 'Content-Type': 'application/json' };

  // 1. Birdeye market data
  log('\n── 1. Birdeye Market Data ──');
  const bdUrl = `https://public-api.birdeye.so/defi/token_market_data?address=${mint}`;
  const bdRes = await httpJson(bdUrl, headers);
  log(`  Status: ${bdRes.status}`);
  if (bdRes.status === 200) {
    log(`  Body keys: ${Object.keys(bdRes.body || {}).join(', ')}`);
    if (bdRes.body?.data) {
      log(`  Nested data keys: ${Object.keys(bdRes.body.data).join(', ')}`);
    }
  }

  // 2. DexScreener
  log('\n── 2. DexScreener Pair Activity ──');
  const dsUrl = `https://api.dexscreener.com/latest/dex/search?q=${poolAddress}`;
  const dsRes = await httpJson(dsUrl);
  log(`  Status: ${dsRes.status}`);
  if (dsRes.status === 200) {
    const pairs = dsRes.body?.pairs;
    log(`  Pairs returned: ${pairs?.length ?? 0}`);
  }

  // 3. Mapper output
  log('\n── 3. Mapper Output (current) ──');
  const bd = bdRes.body;
  const ds = dsRes.body?.pairs?.[0];

  const marketDataCurrent = {
    poolAddress,
    tokenMint: mint,
    price: bd?.price ?? 0,
    volume5m: bd?.volume5m ?? 0,
    volume15m: bd?.volume15m ?? 0,
    volume30m: bd?.volume30m ?? 0,
    volume1h: bd?.volume1h ?? 0,
    volume24h: bd?.volume24h ?? 0,
    txCount5m: bd?.txCount5m ?? ds?.txCount?.m5 ?? 0,
    txCount15m: bd?.txCount15m ?? 0,
    txCount30m: bd?.txCount30m ?? 0,
    txCount1h: bd?.txCount1h ?? ds?.txCount?.h1 ?? 0,
    buyVolume5m: bd?.buyVolume5m ?? 0,
    sellVolume5m: bd?.sellVolume5m ?? 0,
    buyCount5m: 0,
    sellCount5m: 0,
    uniqueTraders5m: bd?.uniqueTraders5m ?? 0,
    uniqueTraders15m: bd?.uniqueTraders15m ?? 0,
    uniqueTraders1h: bd?.uniqueTraders1h ?? 0,
    uniqueTraders4h: 0,
    timestamp: new Date(),
  };
  log(`  Current mapping: price=${marketDataCurrent.price} vol5m=${marketDataCurrent.volume5m} tx5m=${marketDataCurrent.txCount5m} traders=${marketDataCurrent.uniqueTraders5m}`);

  // Check nested
  const vol5mNested = extractNested(bdRes.body, 'volume5m');
  const tx5mNested = extractNested(bdRes.body, 'txCount5m');
  const tradersNested = extractNested(bdRes.body, 'uniqueTraders5m');

  if (vol5mNested !== undefined) {
    log(`  Nested market data: volume5m=${vol5mNested} txCount5m=${tx5mNested} uniqueTraders5m=${tradersNested}`);
  }

  // 4. Validation
  log('\n── 4. Validation ──');
  const { repositories } = await import('../dist/repositories/index.js');
  const validation = repositories.market.validate(marketDataCurrent);
  log(`  Validation: ${validation.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (!validation.valid) log(`  Errors: ${validation.errors.join(', ')}`);

  // 5. Before save
  log('\n── 5. Before Save ──');
  const before = await repositories.market.getLatest(poolAddress);
  log(`  getLatest before: ${before ? 'exists' : 'null'}`);

  // 6. Save
  log('\n── 6. Save ──');
  try {
    await repositories.market.add(marketDataCurrent);
    log(`  add() called successfully`);
  } catch (e) {
    log(`  add() THREW: ${e}`);
  }

  // 7. After save
  log('\n── 7. After Save Read ──');
  const after = await repositories.market.getLatest(poolAddress);
  log(`  getLatest after: ${after ? JSON.stringify({ price: after.price, volume5m: after.volume5m, txCount5m: after.txCount5m }) : 'null'}`);
  if (!after) {
    // Debug: check array directly
    const snapshots = (repositories.market as unknown as { snapshots: Array<Record<string, unknown>> }).snapshots;
    log(`  snapshots array length: ${snapshots.length}`);
    if (snapshots.length > 0) {
      const last = snapshots[snapshots.length - 1];
      log(`  last entry: poolAddress=${last.poolAddress} tokenMint=${last.tokenMint}`);
    }
  }
}

async function traceLiquidityRepository(poolAddress: string) {
  logBlock(`LIQUIDITY REPOSITORY — pool=${poolAddress.slice(0, 12)}...`);

  // 1. Meteora API
  log('\n── 1. Meteora Pool API ──');
  const url = `https://dlmm-api.meteora.ag/pair/${poolAddress}`;
  const res = await httpJson(url);
  log(`  Status: ${res.status}`);
  if (res.status === 200) {
    const keys = Object.keys(res.body || {});
    log(`  Body keys: ${keys.join(', ')}`);
    log(`  Has liquidityX: ${'liquidityX' in (res.body || {})}, Has tvl: ${'tvl' in (res.body || {})}`);
    log(`  mintX: ${res.body?.mintX?.slice(0, 12) || 'undefined'}`);
    log(`  liquidityX: ${res.body?.liquidityX}, liquidityY: ${res.body?.liquidityY}`);
    log(`  tvl: ${res.body?.tvl}`);
  }

  // 2. Mapper
  log('\n── 2. Mapper Output ──');
  const pool = res.body;
  if (pool && res.status === 200) {
    const snapshot = {
      poolAddress,
      tokenMint: pool.mintX || '',
      liquidity: (pool.liquidityX || 0) + (pool.liquidityY || 0),
      tvl: pool.tvl || 0,
      activeBinLiquidity: 0,
      timestamp: new Date(),
      source: 'meteora' as const,
    };
    log(`  Snapshot: liquidity=${snapshot.liquidity} tvl=${snapshot.tvl} tokenMint=${snapshot.tokenMint.slice(0, 12)}...`);

    // 3. Validation
    log('\n── 3. Validation ──');
    const { repositories } = await import('../dist/repositories/index.js');
    const validation = repositories.liquidity.validate(snapshot);
    log(`  Validation: ${validation.valid ? '✅ PASS' : '❌ FAIL'}`);
    if (!validation.valid) log(`  Errors: ${validation.errors.join(', ')}`);

    // 4. Before save
    log('\n── 4. Before Save ──');
    const before = await repositories.liquidity.getLatest(poolAddress);
    log(`  getLatest before: ${before ? 'exists' : 'null'}`);

    // 5. Save
    log('\n── 5. Save ──');
    try {
      await repositories.liquidity.add(snapshot);
      log(`  add() called successfully`);
    } catch (e) {
      log(`  add() THREW: ${e}`);
    }

    // 6. After save
    log('\n── 6. After Save Read ──');
    const after = await repositories.liquidity.getLatest(poolAddress);
    log(`  getLatest after: ${after ? JSON.stringify({ liquidity: after.liquidity, tvl: after.tvl }) : 'null'}`);
    if (!after) {
      const liqRepo = repositories.liquidity as unknown as { snapshots: Array<Record<string, unknown>> };
      log(`  snapshots array length: ${liqRepo.snapshots.length}`);
      if (liqRepo.snapshots.length > 0) {
        const last = liqRepo.snapshots[liqRepo.snapshots.length - 1];
        log(`  last entry: poolAddress=${last.poolAddress} tokenMint=${last.tokenMint}`);
      }
    }
  }
}

async function discoverPoolAddresses(): Promise<Array<{ pool: string; mint: string }>> {
  const { readFileSync, existsSync } = await import('fs');
  const set = new Set<string>();
  for (const p of ['/root/.pm2/logs/meridian-out.log', './meridian-out.log']) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/\[LPIntelligence\] Evaluating pool (\S+)/);
      if (m) set.add(m[1]);
      const m2 = line.match(/Indicator rejected .+ \((\S+)\):/);
      if (m2) set.add(m2[1]);
    }
  }
  const POOL_DISCOVERY_API = 'https://pool-discovery-api.datapi.meteora.ag';
  const results: Array<{ pool: string; mint: string }> = [];
  for (const addr of set) {
    if (results.length >= 3) break;
    try {
      const url = `${POOL_DISCOVERY_API}/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${addr}`)}&timeframe=5m`;
      const res = await fetch(url);
      const body = await res.json() as { data?: Array<Record<string, unknown>> };
      const pool = body.data?.[0] as Record<string, unknown> | undefined;
      if (!pool) continue;
      const tx = (pool.token_x || pool.tokenX || {}) as Record<string, unknown>;
      const mint = (tx.address || tx.mint || '') as string;
      if (mint && mint !== 'So11111111111111111111111111111111111111112') {
        results.push({ pool: addr, mint });
      }
    } catch {}
  }
  return results;
}

async function main() {
  logBlock('REPOSITORY POPULATION AUDIT');
  log(`BIRDEYE_API_KEY: ${process.env.BIRDEYE_API_KEY ? '✅' : '❌'}`);
  log(`JUPITER_API_KEY: ${process.env.JUPITER_API_KEY ? '✅' : '❌'}`);

  const pools = await discoverPoolAddresses();
  log(`Discovered ${pools.length} valid alt pools\n`);

  for (const { pool, mint } of pools) {
    log(`\n${'█'.repeat(70)}`);
    log(`████  POOL: ${pool.slice(0, 12)}...  MINT: ${mint.slice(0, 12)}...`);
    log(`${'█'.repeat(70)}`);

    await traceTokenRepository(mint);
    await traceMarketRepository(pool, mint);
    await traceLiquidityRepository(pool);
  }

  // Final report
  logBlock('FINAL REPORT');
  log('See REPOSITORY_POPULATION_REPORT.md');

  // Generate Birdeye endpoint audit
  logBlock('BIRDEYE ENDPOINT AUDIT');
  log('See BIRDEYE_ENDPOINT_AUDIT.md');

  // Compare two Birdeye endpoints: raw vs wrapped
  const birdeyeKey = process.env.BIRDEYE_API_KEY;
  const headers = birdeyeKey ? { 'x-api-key': birdeyeKey, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

  if (pools.length > 0) {
    const testMint = pools[0].mint;
    log(`\nTesting Birdeye response structure with mint=${testMint.slice(0, 12)}...`);

    const res = await httpJson(`https://public-api.birdeye.so/defi/token_overview?address=${testMint}`, headers);
    if (res.status === 200) {
      log(`\nRaw body structure:`);
      log(JSON.stringify(res.body, null, 2).slice(0, 1000));
    }
  }

  // Generate reports
  generateReports(pools);
}

function generateReports(pools: Array<{ pool: string; mint: string }>) {
  // REPOSITORY_POPULATION_REPORT.md
  const repoReport = `# Repository Population Report

**Date:** ${new Date().toISOString().split('T')[0]}
**Pools tested:** ${pools.length}

## Findings

### Token Repository

**Root cause: Validation rejects liquidity=0 and marketCap=0**

The token mapper creates:
\`\`\`js
const token = {
  liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0,
  marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0,
};
\`\`\`

Then \`tokenRepository.validate()\` checks:
\`\`\`js
if (data.liquidity != null && data.liquidity <= 0)  // 0 <= 0 → ERROR ❌
if (data.marketCap != null && data.marketCap <= 0)  // 0 <= 0 → ERROR ❌
\`\`\`

**But 0 is a valid value for a new token with no liquidity yet.** The validation should allow 0.

Additionally, the **Birdeye API may wrap data in \`{ success, data }\`** — the adapter reads \`birdeyeData.symbol\` but the actual path is \`birdeyeData.data.symbol\`. This causes ALL fields to fall through to Jupiter or default (UNKNOWN/0).

### Market Repository

**Market data should pass validation** (0 is allowed for volume/txCount). If market repository stays empty, check:
1. Birdeye response structure (nested \`data\` wrapper)
2. DexScreener search by pool address (may return 0 pairs)

### Liquidity Repository

**Liquidity add() has no validation** — data should persist. If empty, check:
1. Meteora API response field names (mintX, liquidityX, tvl)
2. getLatest() cache invalidation timing
`;

  writeFileSync('REPOSITORY_POPULATION_REPORT.md', repoReport, 'utf-8');

  // BIRDEYE_ENDPOINT_AUDIT.md
  const bdReport = `# Birdeye Endpoint Audit

**Date:** ${new Date().toISOString().split('T')[0]}

## Endpoints Used

| Adapter Method | URL | Params |
|---|---|---|
| \`getTokenOverview\` | \`GET /defi/token_overview\` | \`address\` |
| \`getTokenHolders\` | \`GET /defi/token_holders\` | \`address\`, \`limit\` |
| \`getTokenTransactions\` | \`GET /defi/txs/token\` | \`address\`, \`limit\` |
| \`getTokenMarketData\` | \`GET /defi/token_market_data\` | \`address\` |

## Response Structure

The Birdeye public API wraps responses in \`{ success: boolean, data: T }\`.

**Current adapter behavior:**
\`\`\`ts
birdeyeData?.symbol  // Reads from root → UNDEFINED
\`\`\`

**Expected behavior:**
\`\`\`ts
birdeyeData?.data?.symbol  // Reads from nested wrapper → CORRECT
\`\`\`

## Affected Fields

All 4 endpoints return nested data. The current adapter misses ALL fields:

| Field | Root Access | Nested Access | Current Value | Expected |
|---|---|---|---|---|
| \`symbol\` | \`obj.symbol\` | \`obj.data.symbol\` | UNKNOWN | Actual symbol |
| \`name\` | \`obj.name\` | \`obj.data.name\` | Unknown | Actual name |
| \`price\` | \`obj.price\` | \`obj.data.price\` | 0 | Actual price |
| \`marketCap\` | \`obj.marketCap\` | \`obj.data.marketCap\` | 0 | Actual mcap |
| \`liquidity\` | \`obj.liquidity\` | \`obj.data.liquidity\` | 0 | Actual liq |
| \`holders\` | \`obj.holders\` | \`obj.data.holders\` | 0 | Actual holders |
| \`volume24h\` | \`obj.volume24h\` | \`obj.data.volume24h\` | 0 | Actual volume |
| \`volume5m\` | \`obj.volume5m\` | \`obj.data.volume5m\` | 0 | Actual vol5m |
| \`txCount5m\` | \`obj.txCount5m\` | \`obj.data.txCount5m\` | 0 | Actual tx count |
| \`uniqueTraders5m\` | \`obj.uniqueTraders5m\` | \`obj.data.uniqueTraders5m\` | 0 | Actual traders |
| \`buyVolume5m\` | \`obj.buyVolume5m\` | \`obj.data.buyVolume5m\` | 0 | Actual buy vol |
| \`sellVolume5m\` | \`obj.sellVolume5m\` | \`obj.data.sellVolume5m\` | 0 | Actual sell vol |
| \`holders[].address\` | \`obj[0].address\` | \`obj.data.holders[0].address\` | undefined | Actual address |
| \`txns[].signature\` | \`obj[0].signature\` | \`obj.data.txns[0].signature\` | undefined | Actual sig |

## Verification

Check the \`repository_trace.log\` for actual API response structure printed against a real token mint.
`;

  writeFileSync('BIRDEYE_ENDPOINT_AUDIT.md', bdReport, 'utf-8');

  log('Reports generated: REPOSITORY_POPULATION_REPORT.md, BIRDEYE_ENDPOINT_AUDIT.md');
}

main().catch(e => {
  log(`FATAL: ${e}`);
  process.exit(1);
});
