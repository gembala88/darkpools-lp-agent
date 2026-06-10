import { integrations } from '../src/integrations/index.js';
import { repositories } from '../src/repositories/index.js';

const DIVIDER = '='.repeat(90);
const SUB = '-'.repeat(90);

function fmt(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, (key, val) => {
    if (val instanceof Date) return val.toISOString();
    return val;
  }, indent);
}

async function safeAsync<T>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error?: string }> {
  try { const v = await fn(); return { ok: true, value: v }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

function repoCounts(): Record<string, number> {
  const t = (repositories.token as any);
  const h = (repositories.holder as any);
  const tx = (repositories.transaction as any);
  const m = (repositories.market as any);
  const l = (repositories.liquidity as any);
  return {
    Token: t?.tokens?.size ?? 0,
    Holder: h?.holders?.size ?? 0,
    Transaction: tx?.transactions?.length ?? 0,
    Market: m?.snapshots?.length ?? 0,
    Liquidity: l?.snapshots?.length ?? 0,
  };
}

function printRepoDelta(before: Record<string, number>, after: Record<string, number>) {
  console.log(`\n  Repository count delta:`);
  for (const [name, b] of Object.entries(before)) {
    const a = after[name];
    const delta = a - b;
    const icon = delta > 0 ? '✅' : (delta < 0 ? '❌' : '—');
    console.log(`    ${name}: ${b} → ${a} (${icon} ${delta >= 0 ? '+' : ''}${delta})`);
  }
}

async function tracePipeline(mint: string, poolAddress: string) {
  console.log(`\n${DIVIDER}`);
  console.log(`PHASE 65 — DATA PIPELINE AUDIT`);
  console.log(`Mint:  ${mint}`);
  console.log(`Pool:  ${poolAddress}`);
  console.log(`Time:  ${new Date().toISOString()}`);
  console.log(DIVIDER);

  const countsBefore = repoCounts();

  // ═══════════════════════════════════════════
  // PIPELINE A: HOLDER
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[A] HOLDER PIPELINE`);
  console.log(`    fetchAndStoreHolders(${mint.slice(0, 8)}...)`);
  console.log(SUB);

  // A1: Raw Birdeye call
  console.log(`\n  A1. Birdeye endpoint:`);
  const endpointH = `/defi/token_holders?address=${mint}&limit=100`;
  console.log(`      GET https://public-api.birdeye.so${endpointH}`);

  const holderRaw = await safeAsync('birdeye.getTokenHolders', () =>
    integrations.birdeye.getTokenHolders(mint)
  );

  if (holderRaw.ok) {
    const v = holderRaw.value as any;
    console.log(`\n  A2. HTTP status: 200 OK`);
    console.log(`      Raw return (typeof=${typeof v}, isArray=${Array.isArray(v)}):`);
    console.log(`      ${fmt(v).slice(0, 600)}`);

    if (v !== null && typeof v === 'object') {
      console.log(`      Keys: [${Object.keys(v).join(', ')}]`);
      if ('holders' in v) {
        const arr = (v as any).holders;
        console.log(`      v.holders: typeof=${typeof arr}, isArray=${Array.isArray(arr)}, length=${Array.isArray(arr) ? arr.length : 'N/A'}`);
      }
    }

    // A3: Mapper simulation
    console.log(`\n  A3. Mapper simulation (marketDataService.ts:67):`);
    const canMap = Array.isArray(v);
    console.log(`      holders.map(h => ...) → ${canMap ? '✅ WOULD WORK (array)' : '❌ WOULD FAIL: .map is not a function'}`);

    if (!canMap) {
      console.log(`      First failure: marketDataService.ts:67`);
      console.log(`      TypeError: holders.map is not a function`);
      console.log(`      Reason: apiFetch returned ${typeof v} (${v === null ? 'null' : Object.keys(v).join(', ')})`);
      console.log(`      Expected: BirdeyeHolder[] (array)`);
    }
  } else {
    console.log(`\n  A2. HTTP status: FAILED`);
    console.log(`      Error: ${holderRaw.error}`);
  }

  // A4: HolderRepository validation (if data were available)
  console.log(`\n  A4. HolderRepository.validate():`);
  const sampleHolder = { address: 'sample', tokenMint: mint, balance: 1000, percentage: 0.5, firstSeen: new Date(), lastSeen: new Date(), transactionCount: 0, tags: [] };
  const hv = repositories.holder.validate(sampleHolder);
  console.log(`      Sample valid holder:  valid=${hv.valid}, errors=[${hv.errors.join(', ')}]`);

  const badHolder = { ...sampleHolder, balance: -1 };
  const hv2 = repositories.holder.validate(badHolder);
  console.log(`      Sample invalid holder (balance=-1): valid=${hv2.valid}, errors=[${hv2.errors.join(', ')}]`);

  // ═══════════════════════════════════════════
  // PIPELINE B: TRANSACTION
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[B] TRANSACTION PIPELINE`);
  console.log(`    fetchAndStoreTransactions(${mint.slice(0, 8)}..., ${poolAddress.slice(0, 8)}...)`);
  console.log(SUB);

  // B1: Raw Birdeye call
  console.log(`\n  B1. Birdeye endpoint:`);
  const endpointT = `/defi/txs/token?address=${mint}&limit=100`;
  console.log(`      GET https://public-api.birdeye.so${endpointT}`);

  const txRaw = await safeAsync('birdeye.getTokenTransactions', () =>
    integrations.birdeye.getTokenTransactions(mint)
  );

  if (txRaw.ok) {
    const v = txRaw.value as any;
    console.log(`\n  B2. HTTP status: 200 OK`);
    console.log(`      Raw return (typeof=${typeof v}, isArray=${Array.isArray(v)}):`);
    console.log(`      ${fmt(v).slice(0, 600)}`);

    if (v !== null && typeof v === 'object') {
      console.log(`      Keys: [${Object.keys(v).join(', ')}]`);
      if ('txns' in v) {
        const arr = (v as any).txns;
        console.log(`      v.txns: typeof=${typeof arr}, isArray=${Array.isArray(arr)}, length=${Array.isArray(arr) ? arr.length : 'N/A'}`);
      }
    }

    // B3: Mapper simulation
    console.log(`\n  B3. Mapper simulation (marketDataService.ts:86):`);
    const canMap = Array.isArray(v);
    console.log(`      txs.map(t => ...) → ${canMap ? '✅ WOULD WORK (array)' : '❌ WOULD FAIL: .map is not a function'}`);

    if (!canMap) {
      console.log(`      First failure: marketDataService.ts:86`);
      console.log(`      TypeError: txs.map is not a function`);
      console.log(`      Reason: apiFetch returned ${typeof v} (${v === null ? 'null' : Object.keys(v).join(', ')})`);
      console.log(`      Expected: BirdeyeTransaction[] (array)`);
    }
  } else {
    console.log(`\n  B2. HTTP status: FAILED`);
    console.log(`      Error: ${txRaw.error}`);
  }

  // B4: TransactionRepository validation
  console.log(`\n  B4. TransactionRepository.validate():`);
  const sampleTx = { signature: 'sig', poolAddress, tokenMint: mint, type: 'buy' as const, amount: 100, volumeUsd: 50, price: 0.5, walletAddress: 'wallet', timestamp: new Date(), isSmartMoney: false, uniqueKey: 'sig:buy' };
  const tv = repositories.transaction.validate(sampleTx);
  console.log(`      Sample valid tx:  valid=${tv.valid}, errors=[${tv.errors.join(', ')}]`);

  const badTx = { ...sampleTx, type: 'invalid' as any };
  const tv2 = repositories.transaction.validate(badTx);
  console.log(`      Sample invalid tx (type=invalid): valid=${tv2.valid}, errors=[${tv2.errors.join(', ')}]`);

  // ═══════════════════════════════════════════
  // PIPELINE C: LIQUIDITY
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[C] LIQUIDITY PIPELINE`);
  console.log(`    syncPoolLiquidity(${poolAddress.slice(0, 8)}...)`);
  console.log(SUB);

  // C1: Raw Meteora call
  console.log(`\n  C1. Meteora endpoint:`);
  console.log(`      GET https://dlmm-api.meteora.ag/pair/${poolAddress}`);

  const poolRaw = await safeAsync('meteora.getPool', () =>
    integrations.meteora.getPool(poolAddress)
  );

  if (poolRaw.ok) {
    const v = poolRaw.value as any;
    console.log(`\n  C2. HTTP status: 200 OK`);
    console.log(`      Raw return (typeof=${typeof v}):`);
    console.log(`      ${fmt(v).slice(0, 600)}`);

    if (v !== null && typeof v === 'object') {
      console.log(`      Keys: [${Object.keys(v).join(', ')}]`);

      // Check critical fields
      const fields = ['mintX', 'mint_y', 'liquidityX', 'liquidity_y', 'liquidityX', 'liquidityY', 'tvl', 'address', 'name'];
      console.log(`\n      Field availability:`);
      for (const f of fields) {
        const val = v[f];
        const status = val !== undefined ? (f === 'mintX' || f === 'mint_y' ? `'${String(val).slice(0, 12)}...'` : String(val)) : '❌ undefined';
        console.log(`        ${f.padEnd(15)} = ${status}`);
      }
    }

    // C3: Mapper simulation
    console.log(`\n  C3. Mapper simulation (marketDataService.ts:154-162):`);
    const tokenMintVal = v?.mintX ?? v?.mint_y ?? 'UNKNOWN';
    const liqVal = v ? (v.liquidityX ?? 0) + (v.liquidityY ?? 0) : 0;
    const tvlVal = v?.tvl ?? 0;

    const liqIssues: string[] = [];
    if (!v?.mintX && !v?.mint_y) liqIssues.push('mintX/mint_y not found');
    if (v?.liquidityX === undefined) liqIssues.push('liquidityX not found');
    if (v?.liquidityY === undefined) liqIssues.push('liquidityY not found');
    if (v?.tvl === undefined) liqIssues.push('tvl not found');

    if (liqIssues.length > 0) {
      console.log(`      ⚠️  Issues detected:`);
      liqIssues.forEach(issue => console.log(`        - ${issue}`));
      console.log(`      First failure: marketDataService.ts:155-156`);
      console.log(`      Reason: field name mismatch between API and interface`);
    }

    const snapshot = {
      poolAddress,
      tokenMint: tokenMintVal,
      liquidity: liqVal,
      tvl: tvlVal,
      activeBinLiquidity: 0,
      timestamp: new Date(),
      source: 'meteora',
    };
    console.log(`      Resulting snapshot: ${fmt(snapshot, 4)}`);

    // C4: Repository save simulation
    console.log(`\n  C4. LiquidityRepository.add():`);
    console.log(`      add() has no validation call — snapshot pushed directly`);
    const wouldSave = tokenMintVal !== 'UNKNOWN' && !isNaN(liqVal) && !isNaN(tvlVal);
    console.log(`      Would save? ${wouldSave ? '✅ YES' : '❌ NO'}`);
    if (!wouldSave) {
      if (tokenMintVal === 'UNKNOWN') console.log(`        - tokenMint is missing (mintX/mint_y not in response)`);
      if (isNaN(liqVal)) console.log(`        - liquidity is NaN (liquidityX/liquidityY not found)`);
      if (isNaN(tvlVal)) console.log(`        - tvl is NaN`);
    }
  } else {
    console.log(`\n  C2. HTTP status: FAILED`);
    console.log(`      Error: ${poolRaw.error}`);
  }

  // C5: LiquidityRepository validation
  console.log(`\n  C5. LiquidityRepository.validate():`);
  const sampleLiq = { poolAddress, tokenMint: mint, liquidity: 100000, tvl: 80000, activeBinLiquidity: 0, timestamp: new Date(), source: 'meteora' };
  const lv = repositories.liquidity.validate(sampleLiq);
  console.log(`      Sample valid snapshot:  valid=${lv.valid}, errors=[${lv.errors.join(', ')}]`);
  console.log(`      ⚠️  NOTE: add() does NOT call validate() — validation is not in the save path`);

  const zeroLiq = { ...sampleLiq, liquidity: 0 };
  const lv2 = repositories.liquidity.validate(zeroLiq);
  console.log(`      Zero liquidity snapshot: valid=${lv2.valid}, errors=[${lv2.errors.join(', ')}]`);
  console.log(`      ⚠️  liquidity <= 0 validation would reject zero, but it's not called from add()`);

  // ═══════════════════════════════════════════
  // FINAL: Repository delta
  // ═══════════════════════════════════════════
  const countsAfter = repoCounts();
  console.log(`\n${SUB}`);
  console.log(`[D] REPOSITORY COUNT DELTA`);
  console.log(SUB);
  printRepoDelta(countsBefore, countsAfter);

  // ═══════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════
  console.log(`\n${SUB}`);
  console.log(`[E] FIRST FAILURE SUMMARY`);
  console.log(SUB);

  const failures: string[] = [];

  // Holder
  if (!holderRaw.ok) {
    failures.push(`Holder: birdeye.getTokenHolders() FAILED — ${holderRaw.error}`);
  } else {
    const v = holderRaw.value as any;
    if (!Array.isArray(v)) {
      failures.push(`Holder: TYPE MISMATCH at marketDataService.ts:67`);
      failures.push(`        apiFetch returned object {${Object.keys(v).join(', ')}} but code expects BirdeyeHolder[]`);
      failures.push(`        holders.map() throws "TypeError: holders.map is not a function"`);
    }
  }

  // Transaction
  if (!txRaw.ok) {
    failures.push(`Transaction: birdeye.getTokenTransactions() FAILED — ${txRaw.error}`);
  } else {
    const v = txRaw.value as any;
    if (!Array.isArray(v)) {
      failures.push(`Transaction: TYPE MISMATCH at marketDataService.ts:86`);
      failures.push(`        apiFetch returned object {${Object.keys(v).join(', ')}} but code expects BirdeyeTransaction[]`);
      failures.push(`        txs.map() throws "TypeError: txs.map is not a function"`);
    }
  }

  // Liquidity
  if (!poolRaw.ok) {
    failures.push(`Liquidity: meteora.getPool() FAILED — ${poolRaw.error}`);
  } else {
    const v = poolRaw.value as any;
    if (v && !v.mintX && !v.mint_y) {
      failures.push(`Liquidity: FIELD NAME MISMATCH at marketDataService.ts:155-158`);
      failures.push(`        Meteora API returned keys: [${Object.keys(v).join(', ')}]`);
      failures.push(`        Code expects: mintX, liquidityX, liquidityY, tvl`);
      failures.push(`        Pool data shape does not match MeteoraDLMMPool interface`);
    }
    if (v && v.liquidity === 0 && v.tvl === 0) {
      failures.push(`Liquidity: ZERO DATA — pool fetched but liquidity/tvl are 0`);
    }
  }

  if (failures.length === 0) {
    console.log(`\n  ✅ All 3 pipelines appear healthy`);
  } else {
    console.log(`\n  ❌ ${failures.length} pipeline failure(s) detected:\n`);
    for (const f of failures) {
      console.log(`  ❌ ${f}\n`);
    }
  }

  console.log(DIVIDER);
  console.log(`TRACE COMPLETE`);
  console.log(DIVIDER);
}

// ── CLI ──
const poolArg = process.argv.find(a => a.startsWith('--pool='));
const mintArg = process.argv.find(a => a.startsWith('--mint='));

if (!poolArg || !mintArg) {
  console.error('Usage: npx tsx scripts/phase65_pipeline_trace.ts --pool=<address> --mint=<address>');
  process.exit(1);
}

const poolAddress = poolArg.split('=')[1];
const tokenMint = mintArg.split('=')[1];

tracePipeline(tokenMint, poolAddress).catch(err => {
  console.error('TRACE FAILED:', err);
  process.exit(1);
});
