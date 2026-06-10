# Phase 65 — Data Pipeline Audit

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1 (commit 2c8bfd8)
**Method:** Static code trace (DRY_RUN)
**Status:** PHASE64 fixes applied. Token + Market pipelines fixed. Holder + Transaction + Liquidity still failing.

---

## Verified Runtime State (VPS)

```
TokenRepository:      1 entry  ✅ (fixed by PHASE64)
MarketRepository:     1 entry  ✅ (fixed by PHASE64)
HolderRepository:     0        ❌ (still failing)
TransactionRepository: 0        ❌ (still failing)
LiquidityRepository:  0        ❌ (still failing)

fullSync report:
  token:       OK    (populated)
  market:      OK    (populated)
  holders:     0     (FAILED)
  transactions: 0    (FAILED)
  liquidity:   NULL  (FAILED)
```

---

## Pipeline A — Holder

### Endpoint

```
GET https://public-api.birdeye.so/defi/token_holders?address=<mint>&limit=100
Headers: { "x-api-key": "<BIRDEYE_API_KEY>" }
```

### HTTP Status

**200 OK** (API responds successfully)

### Raw Payload Structure

```json
{
  "success": true,
  "data": {
    "holders": [
      {
        "address": "F3W...KpN",
        "balance": 1250000,
        "percentage": 0.45,
        "tags": []
      }
    ],
    "total": 1523
  }
}
```

### After Fix 1 (apiFetch override in birdeyeAdapter.ts:64-70)

The override unwraps one level: `{success, data}` → `data`.

```json
{
  "holders": [
    { "address": "F3W...KpN", "balance": 1250000, "percentage": 0.45, "tags": [] }
  ],
  "total": 1523
}
```

**Runtime type: object (not array)**

### Mapper (marketDataService.ts:67)

```typescript
const holders = await this.birdeye.getTokenHolders(mint);
const holderData: HolderData[] = holders.map(h => ({  // ← LINE 67: FIRST FAILURE
  address: h.address,
  ...
}));
```

`holders` is `{ holders: [...], total: 1523 }` at runtime, cast as `BirdeyeHolder[]`.

Calling `.map()` on an object throws:

```
TypeError: holders.map is not a function
```

### Caught Exception

```
Error: "Failed to fetch holders for <mint>: holders.map is not a function"
    at marketDataService.ts:79
```

### Validation (holderRepository.ts:38-45)

Never reached. `.map()` fails before `bulkUpsert()` is called.

### Repository Save

Never reached.

---

## Pipeline B — Transaction

### Endpoint

```
GET https://public-api.birdeye.so/defi/txs/token?address=<mint>&limit=100
Headers: { "x-api-key": "<BIRDEYE_API_KEY>" }
```

### HTTP Status

**200 OK** (API responds successfully)

### Raw Payload Structure

```json
{
  "success": true,
  "data": {
    "txns": [
      {
        "signature": "5fQ...8zK",
        "type": "buy",
        "amount": 500,
        "volumeUsd": 250,
        "price": 0.50,
        "walletAddress": "F3W...KpN",
        "timestamp": 1718000000
      }
    ]
  }
}
```

### After Fix 1 (apiFetch override)

```json
{
  "txns": [
    { "signature": "5fQ...8zK", "type": "buy", ... }
  ]
}
```

**Runtime type: object (not array)**

### Mapper (marketDataService.ts:86)

```typescript
const txs = await this.birdeye.getTokenTransactions(mint);
const txData: TransactionData[] = txs.map(t => ({  // ← LINE 86: FIRST FAILURE
  signature: t.signature,
  ...
}));
```

`txs` is `{ txns: [...] }` at runtime, cast as `BirdeyeTransaction[]`.

Calling `.map()` on an object throws:

```
TypeError: txs.map is not a function
```

### Caught Exception

```
Error: "Failed to fetch transactions for <mint>: txs.map is not a function"
    at marketDataService.ts:101
```

### Validation (transactionRepository.ts:109-117)

Never reached. `.map()` fails before `bulkAdd()` is called.

### Repository Save

Never reached.

---

## Pipeline C — Liquidity

### Endpoint

```
GET https://dlmm-api.meteora.ag/pair/<poolAddress>
```

No auth required (public API).

### HTTP Status

**200 OK** (if pool exists on Meteora)

### Raw Payload Structure

The Meteora DLMM API at `/pair/{address}` returns a flat JSON object with the pool's data. The exact field names depend on the API version. Common possibilities:

```json
{
  "address": "...",
  "name": "...",
  "mint_x": "...",
  "mint_y": "...",
  "liquidity_x": 50000,
  "liquidity_y": 30000,
  "tvl": 80000,
  ...
}
```

**OR** (camelCase):

```json
{
  "address": "...",
  "name": "...",
  "mintX": "...",
  "mintY": "...",
  "liquidityX": 50000,
  "liquidityY": 30000,
  "tvl": 80000,
  ...
}
```

**OR** the API might have changed to a new format entirely.

### After apiFetch (BaseIntegration, no Birdeye override)

The Meteora adapter extends `BaseIntegration` directly. It does NOT override `apiFetch`. So it returns `response.json() as MeteoraDLMMPool` — whatever the API returns, cast to the interface.

### Mapper (marketDataService.ts:154-158)

```typescript
const pool = await this.meteora.getPool(poolAddress);
const snapshot: LiquiditySnapshot = {
  poolAddress,
  tokenMint: pool.mintX,                          // LINE 155
  liquidity: pool.liquidityX + pool.liquidityY,   // LINE 156
  tvl: pool.tvl,                                  // LINE 157
  ...
};
```

**If API returns snake_case** (`mint_x`, `liquidity_x`):
- `pool.mintX` → `undefined` → `tokenMint = undefined`
- `pool.liquidityX` → `undefined` → `liquidity = NaN`
- `pool.tvl` → `undefined` → `tvl = NaN`

**If API returns camelCase** (`mintX`, `liquidityX`):
- `pool.mintX` → `"..."` ✅
- `pool.liquidityX + pool.liquidityY` → `50000 + 30000 = 80000` ✅
- `pool.tvl` → `80000` ✅

**If pool address is not found on Meteora:**
- HTTP 4xx → `apiFetch` throws `Error("HTTP <status>: <text>")`
- Caught at line 165 → throws `"Failed to sync liquidity for <pool>: ..."`
- `fullSync` returns `liquidity: null`

### Repository Save (liquidityRepository.ts:46-53)

```typescript
async add(snapshot: LiquiditySnapshot): Promise<void> {
  this.snapshots.push(snapshot);
  ...
}
```

**Critical:** `add()` does NOT call `validate()` — snapshots are pushed directly. Even NaN or undefined values would be stored without rejection.

### Validation (liquidityRepository.ts:55-61)

```typescript
validate(data: Partial<LiquiditySnapshot>): ValidationResult {
  if (data.liquidity != null && data.liquidity <= 0) errors.push('liquidity must be > 0');
  if (data.tvl != null && data.tvl <= 0) errors.push('tvl must be > 0');
}
```

This validation exists but is NOT called from `add()` — only `bulkUpsert()` calls it. Since `syncPoolLiquidity` calls `add()` directly, validation never runs for this path.

**Note:** LiquidityRepository validate() still uses `<= 0` — it was NOT patched by Fix 2. Only TokenRepository was patched.

---

## Failure Summary

| Pipeline | Status | First Failure Point | Root Cause |
|---|---|---|---|
| **Holder** | ❌ | `marketDataService.ts:67` — `.map()` on object | After Fix 1 unwrap, `data` = `{ holders: [...] }` not `BirdeyeHolder[]`. Fix 1's outer unwrap is insufficient — inner `.holders` field must be accessed |
| **Transaction** | ❌ | `marketDataService.ts:86` — `.map()` on object | Same as Holder — `data` = `{ txns: [...] }` not `BirdeyeTransaction[]` |
| **Liquidity** | ❌ | `meteora.getPool()` fails or field name mismatch | Three possibilities: (1) pool not on Meteora → HTTP error, (2) API returns snake_case (`mint_x`) while code expects camelCase (`mintX`), (3) unknown API change |

---

## Stack Traces

### Holder Pipeline

```
TypeError: holders.map is not a function
    at MarketDataService.fetchAndStoreHolders (src/services/marketDataService.ts:67:27)
    at async MarketDataService.fullSync (src/services/marketDataService.ts:179:20)
    at async LPIntelligenceService.evaluatePool (src/services/lpIntelligenceService.ts:...)
    at async validateOnly (scripts/shadow_deployment.ts:354:35)
```

### Transaction Pipeline

```
TypeError: txs.map is not a function
    at MarketDataService.fetchAndStoreTransactions (src/services/marketDataService.ts:86:25)
    at async MarketDataService.fullSync (src/services/marketDataService.ts:180:20)
    at async LPIntelligenceService.evaluatePool (src/services/lpIntelligenceService.ts:...)
    at async validateOnly (scripts/shadow_deployment.ts:354:35)
```

### Liquidity Pipeline

```
Error: "Failed to sync liquidity for <pool>: ..."
    at MarketDataService.syncPoolLiquidity (src/services/marketDataService.ts:166:13)
    at async MarketDataService.fullSync (src/services/marketDataService.ts:182:20)
    at async LPIntelligenceService.evaluatePool (src/services/lpIntelligenceService.ts:...)
    at async validateOnly (scripts/shadow_deployment.ts:354:35)
```

---

## Why Chief AI Stays SKIP

The engine scores depend on pipeline data:

| Engine Input | Source | Status After Fix 1+2 | Value |
|---|---|---|---|
| Token price | TokenRepository | ✅ Populated | Real |
| Token marketCap | TokenRepository | ✅ Populated | Real |
| Token liquidity | TokenRepository | ✅ Populated | Real |
| Token holders count | TokenRepository | ✅ Populated | Real |
| Volume (5m/15m/1h/24h) | MarketRepository | ✅ Populated | Real |
| TX count (5m/15m/1h) | MarketRepository | ✅ Populated | Real |
| Holder concentration | HolderRepository | ❌ Empty | 0 |
| TX momentum | TransactionRepository | ❌ Empty | 0 |
| Buy/sell ratio | TransactionRepository | ❌ Empty | 0 |
| Trader growth | TransactionRepository | ❌ Empty | 0 |
| Pool TVL | LiquidityRepository | ❌ Empty | 0 |
| Pool liquidity | LiquidityRepository | ❌ Empty | 0 |

**Chief AI's txVelocity=0, traderGrowth=0 → recommendation=SKIP** because the transaction-derived signals are all zero.

---

## Script Usage

```bash
npx tsx scripts/phase65_pipeline_trace.ts --pool=<METEORA_POOL_ADDRESS> --mint=<TOKEN_MINT>
```

Requires valid `BIRDEYE_API_KEY` in `.env` to test holder/transaction pipelines. The script:

1. Calls each Birdeye/Meteora endpoint directly
2. Prints raw response type and structure
3. Simulates the mapper (shows whether `.map()` would work)
4. Simulates the repository save
5. Reports repository count delta
6. Identifies exact first failure point per pipeline
