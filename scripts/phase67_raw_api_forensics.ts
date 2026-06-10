import { integrations } from '../src/integrations/index.js';
import { repositories } from '../src/repositories/index.js';
import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'fs';

dotenvConfig();

const DIVIDER = '='.repeat(90);
const SUB = '-'.repeat(90);

function fmt(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, (key, val) => {
    if (val instanceof Date) return val.toISOString();
    return val;
  }, indent);
}

async function rawFetch(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers });
  const body = await res.json() as unknown;
  return { status: res.status, body };
}

async function safeAsync<T>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error?: string }> {
  try { const v = await fn(); return { ok: true, value: v }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

function loadEnv(): { birdeyeKey: string | undefined } {
  let birdeyeKey = process.env.BIRDEYE_API_KEY;
  if (!birdeyeKey && existsSync('.env')) {
    const envContent = readFileSync('.env', 'utf-8');
    const match = envContent.match(/^BIRDEYE_API_KEY=(.+)$/m);
    if (match) birdeyeKey = match[1].trim();
  }
  return { birdeyeKey };
}

async function forensics(mint: string, poolAddress: string) {
  const { birdeyeKey } = loadEnv();

  console.log(`\n${DIVIDER}`);
  console.log(`PHASE 67 — RAW API FORENSICS`);
  console.log(`Mint:  ${mint}`);
  console.log(`Pool:  ${poolAddress}`);
  console.log(`Time:  ${new Date().toISOString()}`);
  console.log(`BIRDEYE_API_KEY: ${birdeyeKey ? `✅ present (${birdeyeKey.slice(0, 8)}...)` : '❌ NOT FOUND'}`);
  console.log(DIVIDER);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (birdeyeKey) headers['x-api-key'] = birdeyeKey;

  // ═══════════════════════════════════════════
  // PIPELINE 1: TOKEN OVERVIEW
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[1] TOKEN OVERVIEW — ${mint.slice(0, 12)}...`);
  console.log(SUB);

  const tokenUrl = `https://public-api.birdeye.so/defi/token_overview?address=${mint}`;
  console.log(`\n  RAW HTTP GET ${tokenUrl}`);

  const rawTokenResp = await rawFetch(tokenUrl, headers);
  console.log(`  HTTP status: ${rawTokenResp.status}`);
  console.log(`  Raw body:`);
  console.log(`  ${fmt(rawTokenResp.body, 4).slice(0, 1500)}`);

  if (rawTokenResp.status !== 200) {
    console.log(`\n  ⚠️  Birdeye API returned HTTP ${rawTokenResp.status} — adapter will return null`);
    console.log(`  → birdeyeData = null → all fields become 0 via ?? fallback`);
  } else {
    const rawBody = rawTokenResp.body as Record<string, unknown>;
    const hasSuccess = 'success' in rawBody;
    const hasData = 'data' in rawBody;
    const data = rawBody?.data as Record<string, unknown> | undefined;
    const innerDataType = data !== undefined ? (Array.isArray(data) ? `array[${data.length}]` : typeof data) : 'undefined';

    console.log(`\n  Response structure analysis:`);
    console.log(`  'success' in body: ${hasSuccess}`);
    console.log(`  'data' in body:    ${hasData}`);
    console.log(`  typeof body.data:  ${innerDataType}`);
    console.log(`  body keys: [${Object.keys(rawBody).join(', ')}]`);

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      console.log(`\n  data keys: [${Object.keys(data).join(', ')}]`);
      const expectedFields = ['symbol', 'price', 'marketCap', 'liquidity', 'holders', 'decimals'];
      for (const f of expectedFields) {
        const val = data[f];
        const status = val !== undefined ? `${val}` : '❌ undefined';
        console.log(`  data.${f} = ${status}`);
      }

      // Show what the adapter returns
      console.log(`\n  Adapter call result:`);
      const adapterResult = await safeAsync('getTokenOverview', () => integrations.birdeye.getTokenOverview(mint));
      if (adapterResult.ok) {
        const av = adapterResult.value as Record<string, unknown>;
        console.log(`  OK — typeof=${typeof av}, keys=[${Object.keys(av).join(', ')}]`);
        for (const f of expectedFields) {
          console.log(`  adapter.${f} = ${av[f] ?? '❌ undefined'}`);
        }
      } else {
        console.log(`  FAILED — ${adapterResult.error}`);
      }
    }
  }

  // ═══════════════════════════════════════════
  // PIPELINE 2: HOLDERS
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[2] TOKEN HOLDERS — ${mint.slice(0, 12)}...`);
  console.log(SUB);

  const holdersUrl = `https://public-api.birdeye.so/defi/token_holders?address=${mint}&limit=10`;
  console.log(`\n  RAW HTTP GET ${holdersUrl}`);

  const rawHoldersResp = await rawFetch(holdersUrl, headers);
  console.log(`  HTTP status: ${rawHoldersResp.status}`);
  console.log(`  Raw body:`);
  console.log(`  ${fmt(rawHoldersResp.body, 4).slice(0, 2000)}`);

  if (rawHoldersResp.status === 200) {
    const rawBody = rawHoldersResp.body as Record<string, unknown>;
    console.log(`\n  Response structure:`);
    console.log(`  keys: [${Object.keys(rawBody).join(', ')}]`);
    if ('data' in rawBody) {
      const d = rawBody.data;
      console.log(`  data: typeof=${typeof d}, isArray=${Array.isArray(d)}`);
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        console.log(`  data keys: [${Object.keys(d as Record<string, unknown>).join(', ')}]`);
        for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
          console.log(`  data.${k}: typeof=${typeof v}, isArray=${Array.isArray(v)}, length=${Array.isArray(v) ? (v as unknown[]).length : 'N/A'}`);
        }
      }
    }

    console.log(`\n  Adapter call result:`);
    const adapterResult = await safeAsync('getTokenHolders', () => integrations.birdeye.getTokenHolders(mint));
    if (adapterResult.ok) {
      const arr = adapterResult.value;
      console.log(`  OK — isArray=${Array.isArray(arr)}, length=${arr.length}`);
      if (arr.length > 0) {
        console.log(`  First item: ${fmt(arr[0], 4)}`);
      }
    } else {
      console.log(`  FAILED — ${adapterResult.error}`);
    }
  }

  // ═══════════════════════════════════════════
  // PIPELINE 3: TRANSACTIONS
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[3] TOKEN TRANSACTIONS — ${mint.slice(0, 12)}...`);
  console.log(SUB);

  const txsUrl = `https://public-api.birdeye.so/defi/txs/token?address=${mint}&limit=5`;
  console.log(`\n  RAW HTTP GET ${txsUrl}`);

  const rawTxsResp = await rawFetch(txsUrl, headers);
  console.log(`  HTTP status: ${rawTxsResp.status}`);
  console.log(`  Raw body:`);
  console.log(`  ${fmt(rawTxsResp.body, 4).slice(0, 2000)}`);

  if (rawTxsResp.status === 200) {
    const rawBody = rawTxsResp.body as Record<string, unknown>;
    console.log(`\n  Response structure:`);
    console.log(`  keys: [${Object.keys(rawBody).join(', ')}]`);
    if ('data' in rawBody) {
      const d = rawBody.data;
      console.log(`  data: typeof=${typeof d}, isArray=${Array.isArray(d)}`);
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        console.log(`  data keys: [${Object.keys(d as Record<string, unknown>).join(', ')}]`);
        for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
          console.log(`  data.${k}: typeof=${typeof v}, isArray=${Array.isArray(v)}, length=${Array.isArray(v) ? (v as unknown[]).length : 'N/A'}`);
        }
      }
    }

    console.log(`\n  Adapter call result:`);
    const adapterResult = await safeAsync('getTokenTransactions', () => integrations.birdeye.getTokenTransactions(mint));
    if (adapterResult.ok) {
      const arr = adapterResult.value;
      console.log(`  OK — isArray=${Array.isArray(arr)}, length=${arr.length}`);
      if (arr.length > 0) {
        console.log(`  First item: ${fmt(arr[0], 4)}`);
      }
    } else {
      console.log(`  FAILED — ${adapterResult.error}`);
    }
  }

  // ═══════════════════════════════════════════
  // PIPELINE 4: MARKET DATA
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[4] MARKET DATA — ${mint.slice(0, 12)}...`);
  console.log(SUB);

  const marketUrl = `https://public-api.birdeye.so/defi/token_market_data?address=${mint}`;
  console.log(`\n  RAW HTTP GET ${marketUrl}`);

  const rawMarketResp = await rawFetch(marketUrl, headers);
  console.log(`  HTTP status: ${rawMarketResp.status}`);
  console.log(`  Raw body:`);
  console.log(`  ${fmt(rawMarketResp.body, 4).slice(0, 1500)}`);

  if (rawMarketResp.status === 200) {
    const rawBody = rawMarketResp.body as Record<string, unknown>;
    console.log(`\n  Response structure:`);
    console.log(`  keys: [${Object.keys(rawBody).join(', ')}]`);
    if ('data' in rawBody) {
      const d = rawBody.data as Record<string, unknown> | undefined;
      if (d && typeof d === 'object') {
        console.log(`  data keys: [${Object.keys(d).join(', ')}]`);
        const expected = ['price', 'volume5m', 'volume15m', 'volume1h', 'txCount5m', 'uniqueTraders5m'];
        for (const f of expected) {
          console.log(`  data.${f} = ${d[f] ?? '❌ undefined'}`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════
  // PIPELINE 5: LIQUIDITY — Meteora
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[5] LIQUIDITY — Meteora pool: ${poolAddress.slice(0, 12)}...`);
  console.log(SUB);

  const meteoraUrl = `https://dlmm-api.meteora.ag/pair/${poolAddress}`;
  console.log(`\n  RAW HTTP GET ${meteoraUrl}`);

  const rawMeteoraResp = await rawFetch(meteoraUrl, {});
  console.log(`  HTTP status: ${rawMeteoraResp.status}`);
  console.log(`  Raw body:`);
  console.log(`  ${fmt(rawMeteoraResp.body, 4).slice(0, 2000)}`);

  if (rawMeteoraResp.status === 200) {
    const rawBody = rawMeteoraResp.body as Record<string, unknown>;
    console.log(`\n  keys: [${Object.keys(rawBody).join(', ')}]`);
    console.log(`  'success' in body: ${'success' in rawBody}`);

    // Check critical field names
    const criticalFields = ['mintX', 'mint_x', 'mintY', 'mint_y', 'liquidityX', 'liquidity_x', 'reserve_x', 'liquidityY', 'liquidity_y', 'reserve_y', 'tvl'];
    console.log(`\n  Critical field availability:`);
    for (const f of criticalFields) {
      const val = rawBody[f];
      if (val !== undefined) {
        const vstr = typeof val === 'string' ? val.slice(0, 12) + '...' : `${val}`;
        console.log(`  ✅ ${f.padEnd(15)} = ${vstr}`);
      } else {
        console.log(`  ❌ ${f.padEnd(15)} = undefined`);
      }
    }

    // Show normalized pool (via adapter)
    console.log(`\n  Adapter (normalized) result:`);
    const adapterResult = await safeAsync('getPool', () => integrations.meteora.getPool(poolAddress));
    if (adapterResult.ok) {
      const p = adapterResult.value;
      console.log(`  OK:`);
      console.log(`  mintX:  ${p.mintX ? p.mintX.slice(0, 12) + '...' : '❌ empty'}`);
      console.log(`  mintY:  ${p.mintY ? p.mintY.slice(0, 12) + '...' : '❌ empty'}`);
      console.log(`  liquidityX: ${p.liquidityX}`);
      console.log(`  liquidityY: ${p.liquidityY}`);
      console.log(`  tvl:        ${p.tvl}`);

      // Show what the snapshot would look like
      const snapshot = {
        poolAddress,
        tokenMint: p.mintX,
        liquidity: p.liquidityX + p.liquidityY,
        tvl: p.tvl,
        activeBinLiquidity: 0,
        timestamp: new Date(),
        source: 'meteora',
      };
      console.log(`\n  Would-be snapshot:`);
      console.log(`  ${fmt(snapshot, 4)}`);
      const wouldSave = p.mintX && !isNaN(p.liquidityX + p.liquidityY) && !isNaN(p.tvl);
      console.log(`  Would save to repository: ${wouldSave ? '✅ YES' : '❌ NO'}`);
    } else {
      console.log(`  FAILED — ${adapterResult.error}`);
    }
  }

  // ═══════════════════════════════════════════
  // PIPELINE 6: DISCOVER POOL FROM getAllPools
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[6] METEORA — discoverPools() first pool`);
  console.log(SUB);

  const poolsResult = await safeAsync('getAllPools', () => integrations.meteora.getAllPools());
  if (poolsResult.ok) {
    const pools = poolsResult.value;
    console.log(`\n  Total pools discovered: ${pools.length}`);
    if (pools.length > 0) {
      const first = pools[0];
      console.log(`\n  First pool:`);
      console.log(`  address: ${first.address.slice(0, 16)}...`);
      console.log(`  name:    ${first.name}`);
      console.log(`  mintX:   ${first.mintX?.slice(0, 12) ?? '❌'}...`);
      console.log(`  mintY:   ${first.mintY?.slice(0, 12) ?? '❌'}...`);
      console.log(`  tvl:     ${first.tvl}`);
      console.log(`  liqX+Y:  ${(first.liquidityX ?? 0) + (first.liquidityY ?? 0)}`);

      // Now trace getPool on this pool
      console.log(`\n  Fetching pool via getPool():`);
      const poolResult = await safeAsync('getPool(first)', () => integrations.meteora.getPool(first.address));
      if (poolResult.ok) {
        const p = poolResult.value;
        console.log(`  mintX:  ${p.mintX ? p.mintX.slice(0, 12) + '...' : '❌ empty'}`);
        console.log(`  liqX+Y: ${p.liquidityX + p.liquidityY}`);
        console.log(`  tvl:    ${p.tvl}`);
        const ok = p.mintX && (p.liquidityX + p.liquidityY) > 0 && p.tvl > 0;
        console.log(`  Would save: ${ok ? '✅ YES' : '❌ NO'}`);
      } else {
        console.log(`  FAILED — ${poolResult.error}`);
      }
    }
  } else {
    console.log(`\n  getAllPools FAILED — ${poolsResult.error}`);
  }

  // ═══════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[S] SUMMARY — Where data becomes zero`);
  console.log(SUB);

  const failures: string[] = [];

  if (!birdeyeKey) {
    failures.push('BIRDEYE_API_KEY not found — all Birdeye endpoints will fail with HTTP 401');
  } else {
    const keyOk = rawTokenResp.status === 200;
    if (!keyOk) failures.push(`Birdeye API returned HTTP ${rawTokenResp.status} — check API key validity or rate limits`);

    if (keyOk) {
      const rawBody = rawTokenResp.body as Record<string, unknown>;
      const data = rawBody?.data as Record<string, unknown> | undefined;
      if (!data?.marketCap) failures.push('Token marketCap missing from Birdeye response or undefined after adapter unwrap');
      if (!data?.liquidity) failures.push('Token liquidity missing from Birdeye response or undefined after adapter unwrap');
      if (!data?.holders) failures.push('Token holders missing from Birdeye response or undefined after adapter unwrap');
    }

    // Holders
    if (rawHoldersResp.status !== 200) {
      failures.push(`Holders: Birdeye returned HTTP ${rawHoldersResp.status}`);
    } else {
      const holdersBody = rawHoldersResp.body as Record<string, unknown>;
      const data = holdersBody?.data;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const d = data as Record<string, unknown>;
        const extracted = d.holders ?? d.items ?? d.data;
        if (!extracted) failures.push(`Holders: unknown response shape — data keys=[${Object.keys(d).join(', ')}]`);
      }
    }

    // Transactions
    if (rawTxsResp.status !== 200) {
      failures.push(`Transactions: Birdeye returned HTTP ${rawTxsResp.status}`);
    } else {
      const txsBody = rawTxsResp.body as Record<string, unknown>;
      const data = txsBody?.data;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const d = data as Record<string, unknown>;
        const extracted = d.txns ?? d.transactions ?? d.items ?? d.data;
        if (!extracted) failures.push(`Transactions: unknown response shape — data keys=[${Object.keys(d).join(', ')}]`);
      }
    }
  }

  // Liquidity
  if (rawMeteoraResp.status !== 200) {
    failures.push(`Meteora pool: HTTP ${rawMeteoraResp.status} — pool may not exist on Meteora`);
  } else {
    const meteoraBody = rawMeteoraResp.body as Record<string, unknown>;
    if (!meteoraBody.mintX && !meteoraBody.mint_x) {
      failures.push(`Meteora: no mintX/mint_x field found — pool response structure unexpected`);
    }
    if (!meteoraBody.liquidityX && !meteoraBody.liquidity_x && !meteoraBody.reserve_x) {
      failures.push(`Meteora: no liquidity source found (liquidityX/liquidity_x/reserve_x) — snapshot liquidity will be 0`);
    }
  }

  if (failures.length === 0) {
    console.log(`\n  ✅ All pipelines appear healthy — no data loss points detected`);
  } else {
    console.log(`\n  ❌ ${failures.length} data loss point(s) detected:\n`);
    for (const f of failures) {
      console.log(`  ❌ ${f}\n`);
    }
  }

  console.log(DIVIDER);
  console.log(`FORENSICS COMPLETE`);
  console.log(DIVIDER);
}

const poolArg = process.argv.find(a => a.startsWith('--pool='));
const mintArg = process.argv.find(a => a.startsWith('--mint='));

if (!poolArg || !mintArg) {
  console.error('Usage: npx tsx scripts/phase67_raw_api_forensics.ts --pool=<address> --mint=<address>');
  process.exit(1);
}

const poolAddress = poolArg.split('=')[1];
const tokenMint = mintArg.split('=')[1];

forensics(tokenMint, poolAddress).catch(err => {
  console.error('FORENSICS FAILED:', err);
  process.exit(1);
});
