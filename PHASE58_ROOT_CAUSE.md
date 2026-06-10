# Phase 58 — Repository Population Root Cause

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Status:** Static analysis (DRY_RUN)

---

## Problem Statement

AI Layer returns identical alpha scores (~7.55) for all pools because the **5 in-memory repositories remain empty** after `fullSync()` executes. Even though Birdeye API returns HTTP 200, the data never reaches the repositories, so every sub-engine reads empty/fallback values and produces identical scores.

---

## Root Cause Chain

### Link 1: Birdeye `{success, data}` wrapper is never unwrapped

**File:** `src/integrations/baseIntegration.ts:51`

```ts
return await response.json() as T;
```

The Birdeye public API wraps ALL responses:

```json
{ "success": true, "data": { "symbol": "...", "price": ..., ... } }
```

But `apiFetch<T>()` returns the **entire response object** — including the `success` and `data` wrapper keys. The adapter method `getTokenOverview()` claims to return `BirdeyeTokenOverview`, but actually returns `{ success, data }` typed as `BirdeyeTokenOverview`. All field accesses at the root level return `undefined`.

### Link 2: All 4 Birdeye endpoints affected

| Endpoint | Response structure | Root access | Actual path |
|---|---|---|---|
| `/defi/token_overview` | `{ success, data: { symbol, price, ... } }` | `body.symbol` → undefined | `body.data.symbol` |
| `/defi/token_holders` | `{ success, data: { holders: [...] } }` | `body.holders` → undefined | `body.data.holders` |
| `/defi/txs/token` | `{ success, data: { txns: [...] } }` | `body.txns` → undefined | `body.data.txns` |
| `/defi/token_market_data` | `{ success, data: { price, volume5m, ... } }` | `body.volume5m` → undefined | `body.data.volume5m` |

### Link 3: Undefined Birdeye fields fall through to defaults

**File:** `src/services/marketDataService.ts:38-51`

```ts
const token: TokenData = {
  symbol: birdeyeData?.symbol ?? jupData?.symbol ?? 'UNKNOWN',  // undefined → jupData?.symbol ?? 'UNKNOWN'
  marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0, // undefined → undefined ?? 0 → 0
  liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0, // undefined → undefined ?? 0 → 0
  holders: birdeyeData?.holders ?? jupData?.holders ?? 0,       // undefined → undefined ?? 0 → 0
  price: birdeyeData?.price ?? jupData?.price ?? 0,            // undefined → undefined ?? 0 → 0
  volume24h: birdeyeData?.volume24h ?? 0,                      // undefined → 0
};
```

**Note:** Jupiter's `tokens.jup.ag/token/{mint}` endpoint returns a flat object without `marketCap`, `liquidity`, or `holders` fields — so `jupData?.marketCap` is also `undefined`, and the fallback chain reaches `0`.

**Result:** ALL token fields settle at default values (`0`, `'UNKNOWN'`).

### Link 4: Token validation rejects default values

**File:** `src/repositories/tokenRepository.ts:39-40`

```ts
if (data.liquidity != null && data.liquidity <= 0) errors.push('liquidity must be > 0');
if (data.marketCap != null && data.marketCap <= 0) errors.push('marketCap must be > 0');
```

With `liquidity=0` and `marketCap=0`, validation fails:

```ts
{ valid: false, errors: ['liquidity must be > 0', 'marketCap must be > 0'], warnings: [] }
```

### Link 5: Validation failure throws, skipping `upsert()`

**File:** `src/services/marketDataService.ts:53-58`

```ts
const validation = repositories.token.validate(token);
if (!validation.valid) {
  throw new Error(`Token data validation failed: ${validation.errors.join(', ')}`);
}
return await repositories.token.upsert(token); // NEVER REACHED
```

**The `upsert()` call is skipped entirely.** The token repository's internal `Map` remains empty.

### Link 6: Same pattern repeats for holders, transactions, market data

All 4 Birdeye-dependent sync functions suffer the same nested-data issue:

| Function | API | Repository | Data after sync |
|---|---|---|---|
| `fetchAndStoreTokenData` | token_overview | `token` Map | **empty** (validation throws) |
| `fetchAndStoreHolders` | token_holders | `holder` Map | **empty** (response.data.holders not read) |
| `fetchAndStoreTransactions` | txs/token | `transaction` array | **empty** (response.data.txns not read) |
| `fetchAndStoreMarketData` | token_market_data | `market` snapshots | **0-filled** (response.data.* not read) |
| `syncPoolLiquidity` | Meteora pair API | `liquidity` snapshots | **populated** (flat JSON, no wrapper) |

**Only `syncPoolLiquidity` succeeds** — Meteora's `dlmm-api.meteora.ag` returns flat JSON, so `pool.liquidityX`, `pool.tvl`, etc. read correctly. However, a single snapshot per pool is insufficient for `getAggregated()` (needs ≥2 data points), so engines still get 0 change.

### Link 7: `fullSync` uses `Promise.allSettled` — errors are swallowed

**File:** `src/services/marketDataService.ts:177-191`

```ts
const [token, holders, transactions, market, liquidity] = await Promise.allSettled([
  this.fetchAndStoreTokenData(mint),      // → rejected (validation)
  this.fetchAndStoreHolders(mint),         // → rejected (holders undefined)
  this.fetchAndStoreTransactions(mint, poolAddress), // → rejected (txns undefined)
  this.fetchAndStoreMarketData(mint, poolAddress),   // → fulfilled but all 0s
  this.syncPoolLiquidity(poolAddress),     // → fulfilled, only data source working
]);
```

No error is thrown at the `fullSync` level. `evaluatePool` continues with empty repositories.

### Link 8: Every sub-engine reads empty repos and returns identical defaults

| Engine | Repo read | Empty result | Score |
|---|---|---|---|
| `feeAprPrediction` | liquidity.getLatest, transaction.getRecent | null, [] | **10** |
| `liquidityUtilization` | liquidity.getLatest, market.getLatest | null, null | **0** (REJECTED) |
| `txMomentum` | transaction.getRecent | [] | **10** |
| `capitalInflow` | holder.getByToken, transaction.getRecent, liquidity.getAggregated | [], [], {0,0,0,0} | **0** (REJECTED) |
| `liquidityStability` | liquidity.getAggregated (all timeframes) | {0,0,0,0} for each | **30** |
| `smartMoney` | holder.getByToken, transaction.getSmartMoney | [], [] | **0** |
| `smartLP` | (internal wallet tracking, no repo) | no matching wallets | **0** |
| `rangeEfficiency` | market.getLatest, liquidity.getLatest, transaction.getRecent | null, null, [] | **0** (missing params) |
| `holderGrowth` | holder.getByToken | [] | **0** |
| `narrative` | (uses token name/symbol from options only) | — | **~50** (uniform) |
| `riskV2` | holder.getByToken, holder.getConcentration | [], 0 | **85** (uniform) |
| `lpMomentum` | (duplicates many above) | — | **~50** (uniform) |

All 12 sub-scores are **identical across every pool**. The weighted LP alpha score therefore collapses to the same value for all evaluations.

### Link 9: AI Layer also reads empty repositories

The 9 AI engines (marketRegime, poolActivity, accumulationDetector, etc.) also call repository methods like `repositories.token.getByMint(mint)` and `repositories.liquidity.getLatest(poolAddress)`. With empty repositories, they also receive identical null/empty data for every pool and return identical scores.

---

## Verification (Code Trace)

If `repository_trace_v2.ts` were executed (requires `dist/` to exist and `.env` with `BIRDEYE_API_KEY`), the FIRST FAILING STAGE would be:

```
[FLOW] token.birdeye → SUCCESS          ← HTTP 200 confirmed
[FLOW] token.jupiter → SUCCESS          ← HTTP 200
[FLOW] token.mapper → SUCCESS            ← but ALL fields are defaults
[FLOW] token.validate → FAILURE          ← liquidity=0, marketCap=0
[FLOW] token.save → NEVER REACHED        ← upsert() skipped by throw
[FLOW] token.afterSave → FAILURE          ← getByMint returns null
```

This matches the pattern described in `CURRENT_PHASE.md`:
- "Token overview endpoint returns 200" ✅
- "Repository state remains empty" ✅

---

## Fix Requirements

### Fix 1: Unwrap Birdeye `{success, data}` response

**File:** `src/integrations/baseIntegration.ts:51`

Option A — Detect wrapper in Birdeye adapter:
```ts
// In birdeyeAdapter.ts, override or wrap apiFetch:
protected async apiFetch<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
  const raw = await super.apiFetch<{ success: boolean; data: T }>(endpoint, params);
  return raw.data;
}
```

Option B — Generic flag on apiFetch:
```ts
protected async apiFetch<T>(endpoint: string, params?: Record<string, unknown>, unwrapData = false): Promise<T> {
  // ...
  const raw = await response.json();
  return unwrapData ? (raw as { data: T }).data : raw as T;
}
```

**Recommended:** Option A (minimal blast radius, Birdeye-specific fix).

### Fix 2: Allow `liquidity=0` and `marketCap=0` in validation

**File:** `src/repositories/tokenRepository.ts:39-40`

Change `<=` to `<` for zero checks, or change to warnings:

```ts
if (data.liquidity != null && data.liquidity < 0) errors.push('liquidity cannot be negative');
if (data.marketCap != null && data.marketCap < 0) errors.push('marketCap cannot be negative');
```

A new token legitimately has 0 liquidity and 0 market cap. These should not block insertion.

### Fix 3: Apply Fix 1 pattern to all 4 Birdeye endpoints

The same `{success, data}` wrapper affects:
- `getTokenHolders` — reads `body.data.holders` instead of `body.holders`
- `getTokenTransactions` — reads `body.data.txns` instead of `body.txns`
- `getTokenMarketData` — reads `body.data.*` instead of `body.*`

---

## Scoring Impact

Once both Fix 1 and Fix 2 are applied:

1. Birdeye data reads correctly → token has real `symbol`, `price`, `marketCap`, `liquidity`, `holders`
2. Validation passes → `token.upsert()` executes → token repository populated
3. Holder/transaction/market syncs also succeed → all repos populated
4. Each pool gets its own unique data → sub-engines return distinct scores
5. LP alpha score varies across pools → variance > 1 confirmed

The 7.55 uniform score will be replaced by pool-specific scores ranging from ~30-90 depending on actual token fundamentals.
