import { MarketDataService } from '../src/services/marketDataService.js';
import { repositories } from '../src/repositories/index.js';

const DIVIDER = '='.repeat(90);
const SUB = '-'.repeat(90);

function fmt(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, (key, val) => {
    if (val instanceof Date) return val.toISOString();
    if (key === 'timestamp') return val;
    return val;
  }, indent);
}

function safeCall<T>(label: string, fn: () => T): { ok: boolean; value?: T; error?: string } {
  try { const v = fn(); return { ok: true, value: v }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

async function safeAsync<T>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error?: string }> {
  try { const v = await fn(); return { ok: true, value: v }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

function dumpMapKeys(map: Map<string, unknown> | undefined): string[] {
  if (!map || map.size === 0) return [];
  return Array.from(map.keys());
}

async function snapshot(poolAddress: string, tokenMint: string, options?: Record<string, unknown>) {
  console.log(`\n${DIVIDER}`);
  console.log(`PHASE 62 — REPOSITORY SNAPSHOT AUDIT`);
  console.log(`${DIVIDER}`);
  console.log(`\nPool:   ${poolAddress}`);
  console.log(`Mint:   ${tokenMint}`);
  console.log(`Time:   ${new Date().toISOString()}`);

  // ── REPOSITORY IDENTITY ──
  console.log(`\n${SUB}`);
  console.log(`[0] REPOSITORY IDENTITY`);
  console.log(SUB);
  console.log(`  TokenRepository       ref: ${(repositories.token as any)?.constructor?.name ?? '?'}  id=token`);
  console.log(`  HolderRepository      ref: ${(repositories.holder as any)?.constructor?.name ?? '?'}  id=holder`);
  console.log(`  MarketRepository      ref: ${(repositories.market as any)?.constructor?.name ?? '?'}  id=market`);
  console.log(`  LiquidityRepository   ref: ${(repositories.liquidity as any)?.constructor?.name ?? '?'}  id=liquidity`);
  console.log(`  TransactionRepository ref: ${(repositories.transaction as any)?.constructor?.name ?? '?'}  id=transaction`);

  // ── BEFORE FULLSYNC ──
  console.log(`\n${SUB}`);
  console.log(`[1] REPOSITORY STATE (BEFORE fullSync)`);
  console.log(SUB);

  const tokenRepo = repositories.token as any;
  const holderRepo = repositories.holder as any;
  const marketRepo = repositories.market as any;
  const liqRepo = repositories.liquidity as any;
  const txRepo = repositories.transaction as any;

  const before = {
    token: { mapSize: tokenRepo.tokens?.size ?? '?', listSize: (await safeAsync('token.getAll', () => repositories.token.getAll())).value?.length ?? 0 },
    holder: { mapSize: holderRepo.holders?.size ?? '?', tokenKeys: holderRepo.holders instanceof Map ? dumpMapKeys(holderRepo.holders) : [] },
    market: { arraySize: marketRepo.snapshots?.length ?? '?' },
    liquidity: { arraySize: liqRepo.snapshots?.length ?? '?' },
    transaction: { arraySize: txRepo.transactions?.length ?? '?', sigSetSize: txRepo.seenSignatures?.size ?? '?' },
  };
  console.log(`  Token:       map=${before.token.mapSize}, getAll=${before.token.listSize}`);
  console.log(`  Holder:      map=${before.holder.mapSize}`);
  console.log(`  Market:      snapshots=${before.market.arraySize}`);
  console.log(`  Liquidity:   snapshots=${before.liquidity.arraySize}`);
  console.log(`  Transaction: array=${before.transaction.arraySize}, seenSigs=${before.transaction.sigSetSize}`);

  // ── RUN fullSync ──
  console.log(`\n${SUB}`);
  console.log(`[2] EXECUTING fullSync(tokenMint, poolAddress)`);
  console.log(SUB);

  const mds = new MarketDataService();
  const syncResult = await safeAsync('fullSync', () => mds.fullSync(tokenMint, poolAddress));

  if (syncResult.ok) {
    const sr = syncResult.value!;
    console.log(`  token:       ${sr.token ? `OK symbol=${sr.token.symbol} liq=${sr.token.liquidity} mcap=${sr.token.marketCap}` : 'NULL (FAILED)'}`);
    console.log(`  holders:     ${sr.holders > 0 ? `OK count=${sr.holders}` : '0 (FAILED)'}`);
    console.log(`  transactions:${sr.transactions > 0 ? `OK count=${sr.transactions}` : '0 (FAILED)'}`);
    console.log(`  market:      ${sr.market ? `OK fields: price=${sr.market.price} vol5m=${sr.market.volume5m} tx5m=${sr.market.txCount5m}` : 'NULL (FAILED)'}`);
    console.log(`  liquidity:   ${sr.liquidity ? `OK liq=${sr.liquidity.liquidity} tvl=${sr.liquidity.tvl} src=${sr.liquidity.source}` : 'NULL (FAILED)'}`);
  } else {
    console.log(`  fullSync ERROR: ${syncResult.error}`);
  }

  // ── AFTER FULLSYNC ──
  console.log(`\n${SUB}`);
  console.log(`[3] REPOSITORY STATE (AFTER fullSync)`);
  console.log(SUB);

  const after = {
    token: {
      mapSize: tokenRepo.tokens?.size ?? '?',
      getAll: (await safeAsync('token.getAll', () => repositories.token.getAll())).value as any[] | undefined,
      mapKeys: tokenRepo.tokens instanceof Map ? dumpMapKeys(tokenRepo.tokens) : [],
    },
    holder: {
      mapSize: holderRepo.holders?.size ?? '?',
      mapKeys: holderRepo.holders instanceof Map ? dumpMapKeys(holderRepo.holders) : [],
    },
    market: {
      arraySize: marketRepo.snapshots?.length ?? '?',
      records: marketRepo.snapshots as any[] | undefined,
    },
    liquidity: {
      arraySize: liqRepo.snapshots?.length ?? '?',
      records: liqRepo.snapshots as any[] | undefined,
    },
    transaction: {
      arraySize: txRepo.transactions?.length ?? '?',
      sigSetSize: txRepo.seenSignatures?.size ?? '?',
      records: txRepo.transactions as any[] | undefined,
    },
  };

  console.log(`\n  ── COUNTS ──`);
  console.log(`  TokenRepository:       ${after.token.mapSize} entries (getAll=${after.token.getAll?.length ?? 0})`);
  console.log(`  HolderRepository:      ${after.holder.mapSize} entries`);
  console.log(`  MarketRepository:      ${after.market.arraySize} entries`);
  console.log(`  LiquidityRepository:   ${after.liquidity.arraySize} entries`);
  console.log(`  TransactionRepository: ${after.transaction.arraySize} entries (seenSigs=${after.transaction.sigSetSize})`);

  // ── SAMPLE RECORDS ──
  console.log(`\n  ── SAMPLE RECORDS ──`);

  const tokenAll = after.token.getAll;
  if (tokenAll && tokenAll.length > 0) {
    console.log(`\n  TokenRepository[0]:`);
    console.log(`    ${fmt(tokenAll[0], 4)}`);
  } else {
    console.log(`\n  TokenRepository:   (EMPTY — no records)`);
  }

  if (after.holder.mapSize > 0 && after.holder.mapKeys.length > 0) {
    const firstHolderKey = after.holder.mapKeys[0];
    const firstHolder = holderRepo.holders?.get(firstHolderKey);
    console.log(`\n  HolderRepository keys: [${after.holder.mapKeys.slice(0, 5).join(', ')}${after.holder.mapKeys.length > 5 ? ', ...' : ''}]`);
    if (firstHolder) {
      console.log(`  HolderRepository[0]:`);
      console.log(`    ${fmt(firstHolder, 4)}`);
    }
  } else {
    console.log(`\n  HolderRepository:  (EMPTY — no records)`);
    console.log(`  HolderRepository keys: []`);
  }

  const marketRecords = after.market.records;
  if (marketRecords && marketRecords.length > 0) {
    console.log(`\n  MarketRepository[0]:`);
    console.log(`    ${fmt(marketRecords[0], 4)}`);
    console.log(`  MarketRepository count: ${marketRecords.length}`);
  } else {
    console.log(`\n  MarketRepository:  (EMPTY — no records)`);
  }

  const liqRecords = after.liquidity.records;
  if (liqRecords && liqRecords.length > 0) {
    console.log(`\n  LiquidityRepository[0]:`);
    console.log(`    ${fmt(liqRecords[0], 4)}`);
    console.log(`  LiquidityRepository count: ${liqRecords.length}`);
  } else {
    console.log(`\n  LiquidityRepository: (EMPTY — no records)`);
  }

  const txRecords = after.transaction.records;
  if (txRecords && txRecords.length > 0) {
    console.log(`\n  TransactionRepository[0]:`);
    console.log(`    ${fmt(txRecords[0], 4)}`);
    console.log(`  TransactionRepository count: ${txRecords.length}`);
  } else {
    console.log(`\n  TransactionRepository: (EMPTY — no records)`);
  }

  // ── LOOKUP KEY VERIFICATION ──
  console.log(`\n${SUB}`);
  console.log(`[4] LOOKUP KEY VERIFICATION`);
  console.log(SUB);

  // Token: lookup key = mint
  console.log(`\n  TokenRepository lookup by mint(${tokenMint}):`);
  const tokenLookup = await safeAsync('token.getByMint', () => repositories.token.getByMint(tokenMint));
  if (tokenLookup.ok && tokenLookup.value) {
    console.log(`    FOUND: symbol=${tokenLookup.value.symbol}`);
  } else {
    console.log(`    NOT FOUND: ${tokenLookup.error ?? 'null'}`);
  }

  // Check internal map key
  const internalTokenKeys = after.token.mapKeys;
  const hasTokenKey = internalTokenKeys.includes(tokenMint);
  console.log(`    Internal map keys: [${internalTokenKeys.join(', ')}]`);
  console.log(`    Key '${tokenMint}' in map: ${hasTokenKey ? '✅ YES' : '❌ NO'}`);
  if (!hasTokenKey && internalTokenKeys.length === 0) {
    console.log(`    → Token upsert() was NEVER called (validation threw before insert)`);
  }

  // Holder: lookup key = tokenMint + address
  console.log(`\n  HolderRepository lookup by token(${tokenMint}):`);
  const holderLookup = await safeAsync('holder.getByToken', () => repositories.holder.getByToken(tokenMint));
  if (holderLookup.ok && holderLookup.value && holderLookup.value.length > 0) {
    console.log(`    FOUND: ${holderLookup.value.length} holders`);
    console.log(`    First: ${fmt(holderLookup.value[0], 4)}`);
  } else {
    console.log(`    NOT FOUND: ${holderLookup.error ?? '[] (empty)'}`);
  }

  const internalHolderKeys = after.holder.mapKeys;
  // Holder key format: `holder:${tokenMint}:${address}`
  const expectedHolderPrefix = `holder:${tokenMint}:`;
  const matchingHolderKeys = internalHolderKeys.filter(k => k.startsWith(expectedHolderPrefix));
  console.log(`    Internal map keys: [${internalHolderKeys.slice(0, 10).join(', ')}${internalHolderKeys.length > 10 ? ', ...' : ''}]`);
  console.log(`    Keys matching 'holder:${tokenMint}:*': ${matchingHolderKeys.length}`);
  if (internalHolderKeys.length === 0) {
    console.log(`    → fetchAndStoreHolders threw before bulkUpsert (holders.map not a function)`);
  }

  // Market: lookup key = poolAddress (filtered)
  console.log(`\n  MarketRepository lookup by pool(${poolAddress}):`);
  const marketLookup = await safeAsync('market.getLatest', () => repositories.market.getLatest(poolAddress));
  if (marketLookup.ok && marketLookup.value) {
    console.log(`    FOUND: price=${marketLookup.value.price} vol5m=${marketLookup.value.volume5m} tx5m=${marketLookup.value.txCount5m}`);
  } else {
    console.log(`    NOT FOUND: ${marketLookup.error ?? 'null'}`);
  }

  const marketRecordCount = after.market.records?.filter((r: any) => r.poolAddress === poolAddress).length ?? 0;
  console.log(`    Records matching poolAddress '${poolAddress}': ${marketRecordCount}`);

  if (marketRecordCount > 0 && after.market.records) {
    const poolMkt = after.market.records.find((r: any) => r.poolAddress === poolAddress);
    if (poolMkt) {
      const nonZeroFields = Object.entries(poolMkt).filter(([k, v]) => v !== 0 && v !== '' && k !== 'poolAddress' && k !== 'tokenMint' && k !== 'timestamp');
      console.log(`    Non-zero fields: ${nonZeroFields.length > 0 ? nonZeroFields.map(([k, v]) => `${k}=${v}`).join(', ') : '(none — ALL fields are ZERO)'}`);
    }
  }

  // Liquidity: lookup key = poolAddress (filtered)
  console.log(`\n  LiquidityRepository lookup by pool(${poolAddress}):`);
  const liqLookup = await safeAsync('liquidity.getLatest', () => repositories.liquidity.getLatest(poolAddress));
  if (liqLookup.ok && liqLookup.value) {
    console.log(`    FOUND: liquidity=${liqLookup.value.liquidity} tvl=${liqLookup.value.tvl} source=${liqLookup.value.source}`);
    const aggregated = await safeAsync('liquidity.getAggregated', () => repositories.liquidity.getAggregated(poolAddress, 30));
    if (aggregated.ok) {
      console.log(`    getAggregated(30m): current=${aggregated.value!.current} change=${aggregated.value!.change} changePct=${aggregated.value!.changePercent}`);
    }
  } else {
    console.log(`    NOT FOUND: ${liqLookup.error ?? 'null'}`);
  }

  const liqRecordCount = after.liquidity.records?.filter((r: any) => r.poolAddress === poolAddress).length ?? 0;
  console.log(`    Records matching poolAddress '${poolAddress}': ${liqRecordCount}`);

  // Transaction: lookup key = poolAddress (filtered)
  console.log(`\n  TransactionRepository lookup by pool(${poolAddress}):`);
  const txLookup = await safeAsync('transaction.getByPool', () => repositories.transaction.getByPool(poolAddress, 10));
  if (txLookup.ok && txLookup.value && txLookup.value.length > 0) {
    console.log(`    FOUND: ${txLookup.value.length} transactions`);
    console.log(`    First: ${fmt(txLookup.value[0], 4)}`);
  } else {
    console.log(`    NOT FOUND: ${txLookup.error ?? '[] (empty)'}`);
  }

  console.log(`    Records matching poolAddress '${poolAddress}': ${after.transaction.records?.filter((r: any) => r.poolAddress === poolAddress).length ?? 0}`);

  if (after.transaction.arraySize === 0) {
    console.log(`    → fetchAndStoreTransactions threw before bulkAdd (txs.map not a function)`);
  }

  // ── SAVE vs READ KEY CROSS-VERIFICATION ──
  console.log(`\n${SUB}`);
  console.log(`[5] SAVE KEY vs READ KEY vs LOOKUP KEY`);
  console.log(SUB);

  // Token: save key = mint, read key = mint, lookup key = mint
  console.log(`\n  TokenRepository:`);
  console.log(`    Save key:   token.mint  = '${tokenMint}'`);
  console.log(`    Read key:   token.mint  = '${tokenMint}'`);
  console.log(`    Lookup key: getByMint('${tokenMint}')`);
  console.log(`    Match:      save key === lookup key? ${tokenMint === tokenMint ? '✅ YES' : '❌ NO'}`);
  console.log(`    ⚠️  save NEVER EXECUTED — validation threw before upsert()`);

  // Holder: save key = holder:tokenMint:address, read = holder:tokenMint:address, lookup = tokenMint
  console.log(`\n  HolderRepository:`);
  console.log(`    Save key:   'holder:\${tokenMint}:\${holder.address}'`);
  console.log(`    Read key:   'holder:\${tokenMint}:\${holder.address}'`);
  console.log(`    Lookup key: getByToken('${tokenMint}')  (filters by tokenMint field)`);
  console.log(`    Match:      save key === lookup key? N/A — no records`);
  console.log(`    ⚠️  save NEVER EXECUTED — holders.map failed before bulkUpsert()`);

  // Market: save pushes to array, read = filter by poolAddress, lookup = poolAddress
  console.log(`\n  MarketRepository:`);
  const mktPoolCount = after.market.records?.filter((r: any) => r.poolAddress === poolAddress).length ?? 0;
  console.log(`    Save:       add({ poolAddress: '${poolAddress}', ... })`);
  console.log(`    Read:       getLatest('${poolAddress}')  (filters snapshots by poolAddress)`);
  console.log(`    Lookup key: '${poolAddress}'`);
  console.log(`    Records stored matching this pool: ${mktPoolCount}`);
  console.log(`    Match:      ${mktPoolCount > 0 ? '✅ YES — record found by poolAddress' : '❌ NO — no matching record'}`);

  // Liquidity: same pattern as Market
  console.log(`\n  LiquidityRepository:`);
  const liqPoolCount = after.liquidity.records?.filter((r: any) => r.poolAddress === poolAddress).length ?? 0;
  console.log(`    Save:       add({ poolAddress: '${poolAddress}', ... })`);
  console.log(`    Read:       getLatest('${poolAddress}')  (filters by poolAddress)`);
  console.log(`    Lookup key: '${poolAddress}'`);
  console.log(`    Records stored matching this pool: ${liqPoolCount}`);
  console.log(`    Match:      ${liqPoolCount > 0 ? '✅ YES — record found by poolAddress' : '❌ NO — no matching record'}`);

  // Transaction: same pattern
  console.log(`\n  TransactionRepository:`);
  console.log(`    Save:       add({ poolAddress: '${poolAddress}', ... })`);
  console.log(`    Read:       getByPool('${poolAddress}')  (filters by poolAddress)`);
  console.log(`    Lookup key: '${poolAddress}'`);
  console.log(`    Records stored matching this pool: ${after.transaction.records?.filter((r: any) => r.poolAddress === poolAddress).length ?? 0}`);
  console.log(`    ⚠️  save NEVER EXECUTED — txs.map failed before bulkAdd()`);

  // ── DATA LOSS CHAIN ──
  console.log(`\n${SUB}`);
  console.log(`[6] DATA LOSS CHAIN`);
  console.log(SUB);

  const dataLoss: string[] = [];
  const dataOk: string[] = [];

  // Token
  if (after.token.mapSize === 0) {
    dataLoss.push('TokenRepository: 0 entries — Birdeye wrapper → undefined fields → validation rejects liquidity=0, marketCap=0');
  } else {
    dataOk.push(`TokenRepository: ${after.token.mapSize} entries`);
  }

  // Holder
  if (after.holder.mapSize === 0) {
    dataLoss.push('HolderRepository: 0 entries — Birdeye wrapper → .map fails on {success, data} object');
  } else {
    dataOk.push(`HolderRepository: ${after.holder.mapSize} entries`);
  }

  // Transaction
  if (after.transaction.arraySize === 0) {
    dataLoss.push('TransactionRepository: 0 entries — Birdeye wrapper → .map fails on {success, data} object');
  } else {
    dataOk.push(`TransactionRepository: ${after.transaction.arraySize} entries`);
  }

  // Market
  if (after.market.arraySize === 0) {
    dataLoss.push('MarketRepository: 0 entries — fullSync market result was null');
  } else {
    const hasNonZero = after.market.records?.some((r: any) =>
      r.poolAddress === poolAddress && (r.volume5m !== 0 || r.price !== 0)
    );
    if (hasNonZero) {
      dataOk.push(`MarketRepository: ${after.market.arraySize} entries (with real data)`);
    } else {
      dataLoss.push(`MarketRepository: ${after.market.arraySize} entries but ALL ZERO — Birdeye wrapper causes undefined→0, validation passes`);
    }
  }

  // Liquidity
  if (after.liquidity.arraySize === 0) {
    dataLoss.push('LiquidityRepository: 0 entries — Meteora pool fetch failed');
  } else {
    const liqCount = after.liquidity.records?.filter((r: any) => r.poolAddress === poolAddress).length ?? 0;
    const hasRealTVL = after.liquidity.records?.some((r: any) => r.poolAddress === poolAddress && r.tvl > 0);
    if (hasRealTVL) {
      dataOk.push(`LiquidityRepository: ${liqCount} entry for this pool (with real TVL from Meteora)`);
    } else {
      dataLoss.push(`LiquidityRepository: ${liqCount} entry but TVL = 0`);
    }
  }

  console.log(`\n  ✅ HEALTHY REPOSITORIES:`);
  if (dataOk.length === 0) console.log(`    (none)`);
  else dataOk.forEach(d => console.log(`    ✅ ${d}`));

  console.log(`\n  ❌ DATA LOSS POINTS:`);
  if (dataLoss.length === 0) console.log(`    (none)`);
  else dataLoss.forEach(d => console.log(`    ❌ ${d}`));

  // ── FIRST CONFIRMED DATA LOSS POINT ──
  console.log(`\n${SUB}`);
  console.log(`[7] FIRST CONFIRMED DATA LOSS POINT`);
  console.log(SUB);
  console.log(`
  File: src/services/marketDataService.ts:38-51
  Function: fetchAndStoreTokenData()

  The FIRST repository write is fetchAndStoreTokenData(), which calls:
    - birdeye.getTokenOverview(mint)
    - jupiter.getTokenInfo(mint)

  Birdeye returns:   { "success": true, "data": { "symbol": "...", ... } }
  But apiFetch<T>() returns the raw object WITHOUT unwrapping.
  So birdeyeData.symbol → undefined → ?? 'UNKNOWN'
     birdeyeData.marketCap → undefined → ?? 0
     birdeyeData.liquidity → undefined → ?? 0

  Validation at tokenRepository.ts:39-40:
    if (data.liquidity != null && data.liquidity <= 0) → 0 <= 0 → ERROR
    if (data.marketCap != null && data.marketCap <= 0) → 0 <= 0 → ERROR

  → throw → repositories.token.upsert() NEVER called
  → All subsequent data flows (holder, tx, market) start from a failed token sync
  → Engine reads from empty TokenRepository → default scores → uniform ~7.50

  FIRST CONFIRMED DATA LOSS: fetchAndStoreTokenData() at line 58
  "Token data validation failed: liquidity must be > 0, marketCap must be > 0"
  `);

  console.log(DIVIDER);
  console.log(`SNAPSHOT COMPLETE`);
  console.log(DIVIDER);
}

// ── CLI ──
const poolArg = process.argv.find(a => a.startsWith('--pool='));
const mintArg = process.argv.find(a => a.startsWith('--mint='));

if (!poolArg || !mintArg) {
  console.error('Usage: npx tsx scripts/phase62_repo_snapshot.ts --pool=<address> --mint=<address>');
  process.exit(1);
}

const poolAddress = poolArg.split('=')[1];
const tokenMint = mintArg.split('=')[1];

snapshot(poolAddress, tokenMint).catch(err => {
  console.error('SNAPSHOT FAILED:', err);
  process.exit(1);
});
