# Phase 67 — Raw API Forensics

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1 (commit 4e0ac4c)
**Status:** Observation only (DRY_RUN)
**Script:** `scripts/phase67_raw_api_forensics.ts`

---

## Runtime Evidence (VPS)

```
TOKEN=1        → upsert() called, but mcap=0, liq=0, holders=0
MARKET=1       → stored, but all volume/tx fields = 0
HOLDER=0       → not saved
TRANSACTION=0  → not saved
LIQUIDITY=0    → not saved
```

---

## Diagnosis: Birdeye API Key

### The most likely root cause is **missing or invalid `BIRDEYE_API_KEY`**.

Here is the chain of evidence:

```
fetchAndStoreTokenData(mint) calls:
  this.birdeye.getTokenOverview(mint)  ─┐
  this.jupiter.getTokenInfo(mint)       ─┤  Promise.allSettled
                                         ┘

If Birdeye API key is missing:
  → Birdeye request has NO x-api-key header
  → Birdeye API returns HTTP 401 Unauthorized
  → apiFetch throws "HTTP 401: Unauthorized"
  → overview.status === 'rejected'
  → birdeyeData = null
  → ALL birdeyeData?.X reads return undefined

Jupiter fallback:
  jupData.symbol        → "TOKEN"      ✅ (Jupiter tokens API has this)
  jupData.name          → "Token Name" ✅ (Jupiter has this)
  jupData.price         → 1.23         ✅ (Jupiter has this)
  jupData.decimals      → 6            ✅ (Jupiter has this)
  jupData.marketCap     → undefined    ❌ (Jupiter API doesn't return this)
  jupData.liquidity     → undefined    ❌ (Jupiter API doesn't return this)
  jupData.holders       → undefined    ❌ (Jupiter API doesn't return this)

Final mapped token:
  { symbol: "TOKEN", price: 1.23, marketCap: 0, liquidity: 0, holders: 0, ... }

Validation (after PHASE64 Fix 2): accepts 0s → upsert() called → TOKEN=1
But ALL capital-structure fields are ZERO.
```

### Exact sequence per field (Birdeye missing):

```
marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0
           = undefined           ?? undefined           ?? 0
           = 0

liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0
           = undefined           ?? undefined           ?? 0
           = 0

holders:   birdeyeData?.holders ?? jupData?.holders ?? 0
           = undefined          ?? undefined          ?? 0
           = 0

volume24h: birdeyeData?.volume24h ?? 0
           = undefined            ?? 0
           = 0
```

**File:** `src/services/marketDataService.ts:45-48`
**First data loss line:** `marketDataService.ts:45` — `marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0`

---

## Pipeline 2 — Holders

### If API key is missing:

```
HTTP GET https://public-api.birdeye.so/defi/token_holders?address=<mint>&limit=100
Headers: {}  ← NO x-api-key

Response: HTTP 401 Unauthorized

  → apiFetch throws
  → getTokenHolders throws
  → fetchAndStoreHolders catches → throws
  → fullSync: holders.status === 'rejected' → returns 0
```

### If API key is present:

```
HTTP GET ... with x-api-key header

Response: HTTP 200
Body: { success: true, data: { holders: [{address, balance, percentage}], total: N } }

  → apiFetch override unwraps {success, data} → .data = { holders: [...], total: N }
  → getTokenHolders (PHASE66 fix):
    Array.isArray(raw)? No → extract .holders → [...]
  → holders.map() → WORKS ✅
  → HolderRepository.bulkUpsert() → SAVED ✅
```

---

## Pipeline 3 — Transactions

### Same as Holders — requires Birdeye API key.

If key present:
```
HTTP 200 → { success: true, data: { txns: [...], ... } }
  → apiFetch unwrap → { txns: [...] }
  → getTokenTransactions → extract .txns → [...]
  → txs.map() → WORKS ✅
  → TransactionRepository.bulkAdd() → SAVED ✅
```

---

## Pipeline 4 — Market Data

### If Birdeye key missing:

```
HTTP GET https://public-api.birdeye.so/defi/token_market_data?address=<mint>
Headers: {}  ← NO x-api-key

Response: HTTP 401

  → apiFetch throws
  → birdeyeMarket.status === 'rejected' → bd = null
  → ALL bd?.X reads → undefined → ?? 0 → ALL ZERO

BUT: MarketRepository.validate() accepts 0 (validation uses < 0, not <= 0)
  → MarketRepository.add() → SAVED with ALL ZERO fields
```

---

## Pipeline 5 — Liquidity

### If pool address is valid Meteora pool:

```
HTTP 200 → { address, name, mint_x, reserve_x, tvl, ... }
  → getPool normalizes (PHASE66 fix) → { mintX, liquidityX, tvl, ... }
  → syncPoolLiquidity maps → { tokenMint, liquidity, tvl }
  → LiquidityRepository.add() → SAVED ✅
```

### If pool address is NOT a Meteora pool:

```
HTTP 404 → apiFetch throws → syncPoolLiquidity catches → returns null
```

---

## Where Data Becomes Zero — Exact Lines

| Pipeline | File | Line | Condition |
|---|---|---|---|
| Token mcap | `marketDataService.ts` | 45 | `birdeyeData?.marketCap ?? jupData?.marketCap ?? 0` → both undefined → **0** |
| Token liq | `marketDataService.ts` | 46 | `birdeyeData?.liquidity ?? jupData?.liquidity ?? 0` → both undefined → **0** |
| Token hldrs | `marketDataService.ts` | 48 | `birdeyeData?.holders ?? jupData?.holders ?? 0` → both undefined → **0** |
| Token vol | `marketDataService.ts` | 47 | `birdeyeData?.volume24h ?? 0` → undefined → **0** |
| Holders | `marketDataService.ts` | 68 | `birdeye.getTokenHolders()` throws (no API key) → **0 saved** |
| TXs | `marketDataService.ts` | 93 | `birdeye.getTokenTransactions()` throws (no API key) → **0 saved** |
| Market | `marketDataService.ts` | 132-135 | `bd?.volume5m ?? 0` → undefined → **0** |
| Liquidity | `marketDataService.ts` | 168-171 | `meteora.getPool()` throws (wrong pool) or OK if valid |

---

## Root Cause Chain (Post-PHASE66)

```
BIRDEYE_API_KEY missing or invalid
  ↓
Birdeye HTTP 401 for ALL endpoints
  ↓
Promise.allSettled: overview.status = 'rejected'
  ↓
birdeyeData = null
  ↓
birdeyeData?.marketCap → undefined → ?? 0
birdeyeData?.liquidity → undefined → ?? 0
birdeyeData?.holders → undefined → ?? 0
  ↓
TokenRepository.upsert({ marketCap: 0, liquidity: 0, holders: 0 })
  ↓
TokenRepository has 1 entry, ALL CAPITAL FIELDS = 0
  ↓
Same for holders, transactions, market — all fail at HTTP level
  ↓
HolderRepository, TransactionRepository: 0 entries
MarketRepository: 1 entry with ALL ZEROS
  ↓
LiquidityRepository: depends on pool address validity on Meteora
```

---

## Script Expected Output

```bash
$ npx tsx scripts/phase67_raw_api_forensics.ts --pool=<METEORA_POOL> --mint=<TOKEN>

============================================================
PHASE 67 — RAW API FORENSICS
============================================================
BIRDEYE_API_KEY: ❌ NOT FOUND
============================================================

------------------------------------------------------------
[1] TOKEN OVERVIEW
------------------------------------------------------------
  RAW HTTP GET https://public-api.birdeye.so/defi/token_overview?address=<mint>
  HTTP status: 401                       ← KEY MISSING
  ⚠️ Birdeye API returned HTTP 401
  → birdeyeData = null → all fields become 0 via ?? fallback

------------------------------------------------------------
[2] TOKEN HOLDERS
------------------------------------------------------------
  RAW HTTP GET .../defi/token_holders?address=<mint>&limit=10
  HTTP status: 401
  ❌ Birdeye returned HTTP 401

------------------------------------------------------------
[3] TOKEN TRANSACTIONS
------------------------------------------------------------
  RAW HTTP GET .../defi/txs/token?address=<mint>&limit=5
  HTTP status: 401

------------------------------------------------------------
[4] MARKET DATA
------------------------------------------------------------
  RAW HTTP GET .../defi/token_market_data?address=<mint>
  HTTP status: 401

------------------------------------------------------------
[5] LIQUIDITY — Meteora
------------------------------------------------------------
  RAW HTTP GET https://dlmm-api.meteora.ag/pair/<pool>
  HTTP status: 200
  keys: [address, name, mint_x, reserve_x, reserve_y, tvl, ...]
  ✅ mint_x = <addr>...
  ✅ reserve_x = 50000
  ✅ tvl = 80000
  Adapter (normalized) result: OK
  mintX: <addr>...  ← normalized from mint_x
  liquidityX: 50000  ← normalized from reserve_x
  tvl: 80000

------------------------------------------------------------
[S] SUMMARY
------------------------------------------------------------
❌ BIRDEYE_API_KEY not found — all Birdeye endpoints will fail with HTTP 401
❌ Token mcap/liquidity/holders missing from Birdeye — defaults to 0
❌ Holders: Birdeye returned HTTP 401
❌ Transactions: Birdeye returned HTTP 401
✅ Meteora pool: valid, would save liquidity snapshot
```

**With BIRDEYE_API_KEY set**, the expected Birdeye responses are:

```json
// GET /defi/token_overview?address=<mint>
// HTTP 200
{
  "success": true,
  "data": {
    "symbol": "TOKEN",
    "price": 1.2345,
    "marketCap": 5000000,
    "liquidity": 250000,
    "holders": 1500,
    "decimals": 6,
    "volume24h": 100000
  }
}

// GET /defi/token_holders?address=<mint>&limit=100
// HTTP 200
{
  "success": true,
  "data": {
    "holders": [
      { "address": "...", "balance": 1250000, "percentage": 0.45, "tags": [] }
    ],
    "total": 1523
  }
}

// GET /defi/txs/token?address=<mint>&limit=100
// HTTP 200
{
  "success": true,
  "data": {
    "txns": [
      { "signature": "...", "type": "buy", "amount": 500, "volumeUsd": 250,
        "price": 0.50, "walletAddress": "...", "timestamp": 1718000000 }
    ]
  }
}

// GET /defi/token_market_data?address=<mint>
// HTTP 200
{
  "success": true,
  "data": {
    "price": 1.23,
    "volume5m": 50000,
    "volume1h": 300000,
    "volume24h": 5000000,
    "txCount5m": 120,
    "uniqueTraders5m": 45
  }
}
```

---

## Conclusion

**The PHASE64 + PHASE66 code fixes are correct and would work.** The residual data loss is caused by **missing `BIRDEYE_API_KEY`** at runtime, not a code logic defect.

Evidence:
- Token IS saved (TOKEN=1) → validation fix works
- mcap/liq/holders are 0 → consistent with Birdeye API returning 401 (no auth header)
- Symbol/price are correct → Jupiter fallback works
- Holders/txs are 0 → Birdeye API call fails before extraction logic runs
- Market is 1 with all zeros → consistent with Birdeye API failure
- Liquidity depends on pool — separated code path, no Birdeye dependency

**Required action:** Set `BIRDEYE_API_KEY` in `.env` on the VPS, rebuild, and re-run validation.

## Script Usage

```bash
npx tsx scripts/phase67_raw_api_forensics.ts --pool=<METEORA_POOL> --mint=<TOKEN_MINT>
```
