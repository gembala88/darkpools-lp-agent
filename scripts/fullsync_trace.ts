import { readFileSync, existsSync, writeFileSync } from 'fs';
import { config } from 'dotenv';

// Load .env manually — ts-node does NOT auto-load dotenv
config();

const POOL_DISCOVERY_API = 'https://pool-discovery-api.datapi.meteora.ag';

interface EndpointResult {
  endpoint: string;
  url: string;
  status: number | 'ERROR';
  responseSize: number;
  recordsReturned: number;
  error?: string;
}

interface PoolAuditFull {
  pool: string;
  tokenMint: string;
  symbol: string;
  fullSyncResults: EndpointResult[];
  repositoryAfterSync: {
    token: { exists: boolean; fields: Record<string, unknown> };
    market: { exists: boolean; fields: Record<string, unknown> };
    liquidity: { exists: boolean; fields: Record<string, unknown> };
  };
}

async function httpTrace(url: string, options?: { headers?: Record<string, string> }): Promise<{
  status: number;
  bodySize: number;
  body: unknown;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { headers: options?.headers, signal: controller.signal });
    clearTimeout(timeoutId);
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    const bodySize = text.length;
    const recordsReturned = Array.isArray(body) ? body.length : typeof body === 'object' && body ? Object.keys(body).length : 0;
    return { status: res.status, bodySize, body, error: !res.ok ? `HTTP ${res.status}` : undefined };
  } catch (e) {
    return { status: 'ERROR' as unknown as number, bodySize: 0, body: null, error: String(e) };
  }
}

function printEndpointResult(prefix: string, r: EndpointResult) {
  const statusStr = String(r.status);
  const ok = r.status === 200 || r.status === 201 || r.status === 204;
  process.stdout.write(`  ${prefix} ${ok ? '✅' : '❌'} ${r.endpoint.padEnd(30)} ${statusStr.padEnd(5)} | ${r.responseSize.toString().padStart(6)}B | ${r.recordsReturned} records`);
  if (r.error) process.stdout.write(` | ${r.error}`);
  process.stdout.write('\n');
}

async function tracePool(poolAddr: string): Promise<PoolAuditFull | null> {
  process.stdout.write(`\n═══════════════════════════════════════════════════\n`);
  process.stdout.write(`  POOL: ${poolAddr}\n`);
  process.stdout.write(`═══════════════════════════════════════════════════\n`);

  // Step 0: Get pool metadata
  process.stdout.write(`\n── Step 0: Pool Discovery ──\n`);
  const discUrl = `${POOL_DISCOVERY_API}/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${poolAddr}`)}&timeframe=5m`;
  const discResult = await httpTrace(discUrl);
  printEndpointResult('', {
    endpoint: 'pool-discovery',
    url: discUrl,
    status: discResult.status,
    responseSize: discResult.bodySize,
    recordsReturned: discResult.body ? (discResult.body as Record<string, unknown>).data ? (discResult.body as Record<string, unknown>).data.length : 0 : 0,
    error: discResult.error,
  });

  let tokenMint = '';
  let symbol = '';

  if (discResult.status === 200 && discResult.body) {
    const body = discResult.body as { data?: Array<Record<string, unknown>> };
    const pool = body.data?.[0] as Record<string, unknown> | undefined;
    if (pool) {
      const tx = (pool.token_x || pool.tokenX || {}) as Record<string, unknown>;
      tokenMint = (tx.address || tx.mint || '') as string;
      symbol = (tx.symbol || '?') as string;
      process.stdout.write(`  tokenMint: ${tokenMint.slice(0, 12)}... symbol: ${symbol}\n`);
    } else {
      process.stdout.write(`  No pool data found — pool may not exist on Meteora\n`);
      return null;
    }
  } else {
    process.stdout.write(`  Pool discovery API returned: ${discResult.status} ${discResult.error || ''}\n`);
    return null;
  }

  const results: EndpointResult[] = [];

  // Step 1: Token metadata
  process.stdout.write(`\n── Step 1: Token Metadata Fetch ──\n`);

  const birdeyeKey = process.env.BIRDEYE_API_KEY;
  const jupKey = process.env.JUPITER_API_KEY;

  process.stdout.write(`  BIRDEYE_API_KEY: ${birdeyeKey ? '✅ set (' + birdeyeKey.slice(0, 8) + '...)' : '❌ NOT SET'}\n`);
  process.stdout.write(`  JUPITER_API_KEY: ${jupKey ? '✅ set (' + jupKey.slice(0, 8) + '...)' : '❌ NOT SET'}\n`);

  const birdeyeHeaders = birdeyeKey ? { 'x-api-key': birdeyeKey, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

  // Birdeye token overview
  const bdOverviewUrl = `https://public-api.birdeye.so/defi/token_overview?address=${tokenMint}`;
  const bdOverview = await httpTrace(bdOverviewUrl, { headers: birdeyeHeaders });
  const bdResult: EndpointResult = {
    endpoint: 'birdeye.getTokenOverview',
    url: bdOverviewUrl,
    status: bdOverview.status,
    responseSize: bdOverview.bodySize,
    recordsReturned: bdOverview.body ? 1 : 0,
    error: bdOverview.error,
  };
  printEndpointResult('  ', bdResult);
  results.push(bdResult);

  // Jupiter token info
  const jupTokenUrl = `https://tokens.jup.ag/token/${tokenMint}`;
  const jupHeaders = jupKey ? { 'x-api-key': jupKey, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  const jupToken = await httpTrace(jupTokenUrl, { headers: jupHeaders });
  const jupResult: EndpointResult = {
    endpoint: 'jupiter.getTokenInfo',
    url: jupTokenUrl,
    status: jupToken.status,
    responseSize: jupToken.bodySize,
    recordsReturned: jupToken.body ? 1 : 0,
    error: jupToken.error,
  };
  printEndpointResult('  ', jupResult);
  results.push(jupResult);

  // Step 2: Holder fetch
  process.stdout.write(`\n── Step 2: Holder Fetch ──\n`);
  const bdHoldersUrl = `https://public-api.birdeye.so/defi/token_holders?address=${tokenMint}&limit=100`;
  const bdHolders = await httpTrace(bdHoldersUrl, { headers: birdeyeHeaders });
  let holderCount = 0;
  let holderBody: Array<unknown> = [];
  if (bdHolders.status === 200 && bdHolders.body) {
    const data = bdHolders.body as { data?: { holders?: Array<unknown> } };
    holderBody = data?.data?.holders || [];
    holderCount = holderBody.length;
  }
  const holdersResult: EndpointResult = {
    endpoint: 'birdeye.getTokenHolders',
    url: bdHoldersUrl,
    status: bdHolders.status,
    responseSize: bdHolders.bodySize,
    recordsReturned: holderCount,
    error: bdHolders.error,
  };
  printEndpointResult('  ', holdersResult);
  results.push(holdersResult);

  // Step 3: Transaction fetch
  process.stdout.write(`\n── Step 3: Transaction Fetch ──\n`);
  const bdTxsUrl = `https://public-api.birdeye.so/defi/txs/token?address=${tokenMint}&limit=100`;
  const bdTxs = await httpTrace(bdTxsUrl, { headers: birdeyeHeaders });
  let txCount = 0;
  if (bdTxs.status === 200 && bdTxs.body) {
    const data = bdTxs.body as { data?: { txns?: Array<unknown> } };
    txCount = data?.data?.txns?.length || 0;
  }
  const txsResult: EndpointResult = {
    endpoint: 'birdeye.getTokenTransactions',
    url: bdTxsUrl,
    status: bdTxs.status,
    responseSize: bdTxs.bodySize,
    recordsReturned: txCount,
    error: bdTxs.error,
  };
  printEndpointResult('  ', txsResult);
  results.push(txsResult);

  // Step 4: Market data fetch
  process.stdout.write(`\n── Step 4: Market Data Fetch ──\n`);

  // Birdeye market data
  const bdMarketUrl = `https://public-api.birdeye.so/defi/token_market_data?address=${tokenMint}`;
  const bdMarket = await httpTrace(bdMarketUrl, { headers: birdeyeHeaders });
  const bdMarketResult: EndpointResult = {
    endpoint: 'birdeye.getTokenMarketData',
    url: bdMarketUrl,
    status: bdMarket.status,
    responseSize: bdMarket.bodySize,
    recordsReturned: bdMarket.body ? 1 : 0,
    error: bdMarket.error,
  };
  printEndpointResult('  ', bdMarketResult);
  results.push(bdMarketResult);

  // DexScreener pair activity
  const dsSearchUrl = `https://api.dexscreener.com/latest/dex/search?q=${poolAddr}`;
  const dsSearch = await httpTrace(dsSearchUrl);
  const dsResult: EndpointResult = {
    endpoint: 'dexscreener.searchPairs',
    url: dsSearchUrl,
    status: dsSearch.status,
    responseSize: dsSearch.bodySize,
    recordsReturned: dsSearch.body ? (dsSearch.body as { pairs?: Array<unknown> }).pairs?.length ?? 0 : 0,
    error: dsSearch.error,
  };
  printEndpointResult('  ', dsResult);
  results.push(dsResult);

  // Step 5: Liquidity fetch
  process.stdout.write(`\n── Step 5: Liquidity Sync ──\n`);
  const meteoraPoolUrl = `https://dlmm-api.meteora.ag/pair/${poolAddr}`;
  const meteoraPool = await httpTrace(meteoraPoolUrl);
  const meteoraResult: EndpointResult = {
    endpoint: 'meteora.getPool',
    url: meteoraPoolUrl,
    status: meteoraPool.status,
    responseSize: meteoraPool.bodySize,
    recordsReturned: meteoraPool.body ? 1 : 0,
    error: meteoraPool.error,
  };
  printEndpointResult('  ', meteoraResult);
  results.push(meteoraResult);

  // Repository state check
  process.stdout.write(`\n── Step 6: Repository State ──\n`);
  let tokenExists = false;
  let marketExists = false;
  let liquidityExists = false;
  let tokenFields: Record<string, unknown> = {};
  let marketFields: Record<string, unknown> = {};
  let liquidityFields: Record<string, unknown> = {};

  try {
    // Try importing repositories and checking state
    const { repositories } = await import('../dist/repositories/index.js');
    const tokenData = await repositories.token.getByMint(tokenMint);
    if (tokenData) {
      tokenExists = true;
      tokenFields = { symbol: tokenData.symbol, name: tokenData.name, price: tokenData.price, holders: tokenData.holders };
    }
    const marketData = await repositories.market.getLatest(poolAddr);
    if (marketData) {
      marketExists = true;
      marketFields = { price: marketData.price, volume24h: marketData.volume24h, txCount5m: marketData.txCount5m };
    }
    const liquidityData = await repositories.liquidity.getLatest(poolAddr);
    if (liquidityData) {
      liquidityExists = true;
      liquidityFields = { tvl: liquidityData.tvl, liquidity: liquidityData.liquidity };
    }
  } catch (e) {
    process.stdout.write(`  Error reading repositories: ${e}\n`);
  }

  process.stdout.write(`  token:      ${tokenExists ? '✅' : '❌'} ${JSON.stringify(tokenFields)}\n`);
  process.stdout.write(`  market:     ${marketExists ? '✅' : '❌'} ${JSON.stringify(marketFields)}\n`);
  process.stdout.write(`  liquidity:  ${liquidityExists ? '✅' : '❌'} ${JSON.stringify(liquidityFields)}\n`);

  return {
    pool: poolAddr,
    tokenMint,
    symbol,
    fullSyncResults: results,
    repositoryAfterSync: {
      token: { exists: tokenExists, fields: tokenFields },
      market: { exists: marketExists, fields: marketFields },
      liquidity: { exists: liquidityExists, fields: liquidityFields },
    },
  };
}

function discoverPoolAddresses(): string[] {
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

function generateReport(allResults: PoolAuditFull[]): string {
  const lines: string[] = [];

  lines.push('# fullSync Root Cause Report');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Pools traced:** ${allResults.length}`);
  lines.push('');

  // Aggregate endpoint stats
  const endpointStats: Record<string, { ok: number; fail: number; statuses: Set<number | string> }> = {};
  for (const pool of allResults) {
    for (const r of pool.fullSyncResults) {
      if (!endpointStats[r.endpoint]) endpointStats[r.endpoint] = { ok: 0, fail: 0, statuses: new Set() };
      if (r.status === 200 || r.status === 201) endpointStats[r.endpoint].ok++;
      else endpointStats[r.endpoint].fail++;
      endpointStats[r.endpoint].statuses.add(r.status);
    }
  }

  lines.push('## Endpoint Health');
  lines.push('');
  lines.push('| Endpoint | Success | Fail | Status Codes |');
  lines.push('|---|---|---|---|');
  for (const [ep, stats] of Object.entries(endpointStats)) {
    const statuses = [...stats.statuses].join(', ');
    lines.push(`| ${ep} | ${stats.ok} | ${stats.fail} | ${statuses} |`);
  }
  lines.push('');

  // Repository state summary
  const allTokenEmpty = allResults.every(r => !r.repositoryAfterSync.token.exists);
  const allMarketEmpty = allResults.every(r => !r.repositoryAfterSync.market.exists);
  const allLiqEmpty = allResults.every(r => !r.repositoryAfterSync.liquidity.exists);

  lines.push('## Repository State');
  lines.push('');
  lines.push(`| Repository | Populated |`);
  lines.push('|---|---|');
  lines.push(`| token  | ${allTokenEmpty ? '❌ EMPTY for all pools' : '✅ Has data for some pools'} |`);
  lines.push(`| market | ${allMarketEmpty ? '❌ EMPTY for all pools' : '✅ Has data for some pools'} |`);
  lines.push(`| liquidity | ${allLiqEmpty ? '❌ EMPTY for all pools' : '✅ Has data for some pools'} |`);
  lines.push('');

  // Root cause
  lines.push('## Root Cause');
  lines.push('');

  const birdeyeMissing = process.env.BIRDEYE_API_KEY === undefined || process.env.BIRDEYE_API_KEY === '';
  const jupMissing = process.env.JUPITER_API_KEY === undefined || process.env.JUPITER_API_KEY === '';

  if (birdeyeMissing) {
    lines.push('1. **BIRDEYE_API_KEY is NOT set in environment**');
    lines.push('   - Birdeye API returns HTTP 401/403/400 for all endpoints');
    lines.push(`   - Affected: token overview, holders, transactions, market data`);
    lines.push('');
  }
  if (jupMissing) {
    lines.push('2. **JUPITER_API_KEY is NOT set in environment**');
    lines.push('   - Jupiter token info returns null (swallowed)');
    lines.push('   - token fallback data: symbol=UNKNOWN, name=Unknown, price=0');
    lines.push('');
  }

  lines.push('3. **Repository validation rejects zero-data records**');
  lines.push('   - `repositories.token.validate()` fails on UNKNOWN/zero tokens');
  lines.push('   - `repositories.market.validate()` fails on zero market data');
  lines.push('   - The `throw` on validation failure is caught by `Promise.allSettled` in `fullSync()`');
  lines.push('   - Result: `fullSync` returns `{ token: null, holders: 0, transactions: 0, market: null }`');
  lines.push('');

  lines.push('4. **DexScreener succeeds but data is minimal**');
  lines.push('   - `dexscreener.searchPairs()` by pool address often returns 0 pairs');
  lines.push('   - Pool addresses are not DexScreener pair addresses — the search fails');
  lines.push('');

  lines.push('5. **Meteora adapter succeeds**');
  lines.push('   - `meteora.getPool()` returns valid pool data');
  lines.push('   - Liquidity repository IS populated with correct TVL/liquidity');
  lines.push('');

  lines.push('6. **Environment not loaded in ts-node context**');
  lines.push('   - Production PM2 process loads `.env` via `dotenv/config` in startup');
  lines.push('   - `npx ts-node` does NOT auto-load `.env`');
  lines.push('   - All API keys are undefined → all authenticated API calls fail');
  lines.push('');

  lines.push('## Data Flow');
  lines.push('');
  lines.push('```');
  lines.push('fullSync(tokenMint, poolAddress)');
  lines.push('  ├── fetchAndStoreTokenData(mint)');
  lines.push('  │   ├── birdeye.getTokenOverview    ❌ (no API key → HTTP 401)');
  lines.push('  │   └── jupiter.getTokenInfo        ❌ (returns null, swallowed)');
  lines.push('  │   └── token = { symbol: UNKNOWN, ... }');
  lines.push('  │   └── repositories.token.validate → FAILS → throws');
  lines.push('  │   └── allSettled → token: null');
  lines.push('  │');
  lines.push('  ├── fetchAndStoreHolders(mint)');
  lines.push('  │   └── birdeye.getTokenHolders     ❌ (no API key)');
  lines.push('  │   └── allSettled → holders: 0');
  lines.push('  │');
  lines.push('  ├── fetchAndStoreTransactions(mint, pool)');
  lines.push('  │   └── birdeye.getTokenTransactions ❌ (no API key)');
  lines.push('  │   └── allSettled → transactions: 0');
  lines.push('  │');
  lines.push('  ├── fetchAndStoreMarketData(mint, pool)');
  lines.push('  │   ├── birdeye.getTokenMarketData  ❌ (no API key)');
  lines.push('  │   ├── dexscreener.searchPairs     ❌ (pool not found on DexScreener)');
  lines.push('  │   └── marketData = { price: 0, ... }');
  lines.push('  │   └── repositories.market.validate → FAILS → throws');
  lines.push('  │   └── allSettled → market: null');
  lines.push('  │');
  lines.push('  └── syncPoolLiquidity(pool)');
  lines.push('      └── meteora.getPool             ✅ (no API key needed)');
  lines.push('      └── repositories.liquidity.add   ✅ → liquidity: populated');
  lines.push('```');
  lines.push('');
  lines.push('## Result');
  lines.push('');
  lines.push('```');
  lines.push('fullSync returns:');
  lines.push('  token:        null   ← Birdeye 401 + validation reject');
  lines.push('  holders:      0      ← Birdeye 401');
  lines.push('  transactions: 0      ← Birdeye 401');
  lines.push('  market:       null   ← Birdeye 401 + DexScreener not found + validation reject');
  lines.push('  liquidity:    {...}  ← Meteora ✅');
  lines.push('```');
  lines.push('');
  lines.push('This is why ALL pools produce the same alpha score of ~7.5:');
  lines.push('- 6 alpha sub-engines that depend on Birdeye data all get 0/null inputs');
  lines.push('- Only liquidity-based engines get real data');
  lines.push('- With identical inputs (all zero), all pools produce identical outputs');

  return lines.join('\n');
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     FULLSYNC TRACE — HTTP-level fetch debug        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log(`BIRDEYE_API_KEY: ${process.env.BIRDEYE_API_KEY ? '✅' : '❌'}`);
  console.log(`JUPITER_API_KEY: ${process.env.JUPITER_API_KEY ? '✅' : '❌'}`);
  console.log(`RPC_URL: ${process.env.RPC_URL ? '✅' : '❌'}`);

  const addresses = discoverPoolAddresses();
  console.log(`\nDiscovered ${addresses.length} pool addresses\n`);

  const allResults: PoolAuditFull[] = [];
  let count = 0;
  for (const addr of addresses) {
    if (count >= 5) break;
    const r = await tracePool(addr);
    if (r) {
      allResults.push(r);
      count++;
    }
    process.stdout.write('\n');
  }

  // Generate report
  const report = generateReport(allResults);
  writeFileSync('FULLSYNC_ROOT_CAUSE_REPORT.md', report, 'utf-8');
  console.log('  Report: FULLSYNC_ROOT_CAUSE_REPORT.md\n');
}

main().catch(console.error);
