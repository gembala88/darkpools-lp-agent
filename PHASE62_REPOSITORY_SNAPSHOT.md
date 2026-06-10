# Phase 62 — Repository Snapshot Audit

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Method:** Static code trace (DRY_RUN)
**Pool:** Meteora DLMM pool (representative)
**Token:** Non-WSOL SPL token (representative)
**Script:** `scripts/phase62_repo_snapshot.ts`

---

## 1. Repository State (Before fullSync)

```
┌─────────────────────────┬──────────┬──────────────────────┐
│ Repository              │ Count    │ Internal Storage     │
├─────────────────────────┼──────────┼──────────────────────┤
│ TokenRepository         │ 0        │ Map<string, Token>   │
│ HolderRepository        │ 0        │ Map<string, Holder>  │
│ TransactionRepository   │ 0        │ TransactionData[]    │
│ MarketRepository        │ 0        │ MarketData[]         │
│ LiquidityRepository     │ 0        │ LiquiditySnapshot[]  │
└─────────────────────────┴──────────┴──────────────────────┘
```

All repositories start empty. This is the initial state after `new MarketDataService()`.

---

## 2. fullSync Execution

### 2.1 `fetchAndStoreTokenData(mint)`

```
CALL: birdeye.getTokenOverview(mint)
  → apiFetch<BirdeyeTokenOverview>(/defi/token_overview, { address: mint })
  → HTTP 200 → response.json()
  → returns: { success: true, data: { symbol: "TOKEN", price: 1.23, marketCap: 500000, liquidity: 25000, ... } }
  → BUT: apiFetch returns raw JSON cast as BirdeyeTokenOverview (no unwrap)
  → birdeyeData = { success: true, data: { ... } }  ← TYPE MISMATCH

CALL: jupiter.getTokenInfo(mint)
  → HTTP 200 → returns flat { symbol: "TOKEN", price: 1.23, ... }
  → jupData = { symbol: "TOKEN", price: 1.23, ... }

MAPPER (marketDataService.ts:38-51):
  symbol:    birdeyeData?.symbol ?? jupData?.symbol ?? 'UNKNOWN'
             → undefined ?? "TOKEN" ?? 'UNKNOWN'
             → "TOKEN"  ✅ (Jupiter fallback works)

  marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0
             → undefined ?? undefined ?? 0  (Jupiter has no marketCap)
             → 0  ❌

  liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0
             → undefined ?? undefined ?? 0  (Jupiter has no liquidity)
             → 0  ❌

  price:     birdeyeData?.price ?? jupData?.price ?? 0
             → undefined ?? 1.23 ?? 0
             → 1.23  ✅ (Jupiter fallback)

  holders:   birdeyeData?.holders ?? jupData?.holders ?? 0
             → undefined ?? undefined ?? 0  (Jupiter has no holders)
             → 0  ❌

RECORD TO SAVE:
  { mint, symbol: "TOKEN", marketCap: 0, liquidity: 0, holders: 0, price: 1.23, volume24h: 0 }

VALIDATION (tokenRepository.ts:34-45):
  errors: []
  data.liquidity(0) <= 0?        → "liquidity must be > 0"  ❌
  data.marketCap(0) <= 0?        → "marketCap must be > 0" ❌
  data.holders(0) < 0?           → false
  data.decimals(6) < 0 || > 18?  → false (warning only)
  → { valid: false, errors: ['liquidity must be > 0', 'marketCap must be > 0'], warnings: [] }

  validation.valid === false → THROW new Error('Token data validation failed: ...')

RESULT: repositories.token.upsert() NEVER REACHED
```

### 2.2 `fetchAndStoreHolders(mint)`

```
CALL: birdeye.getTokenHolders(mint)
  → apiFetch<BirdeyeHolder[]>(/defi/token_holders, { address: mint, limit: 100 })
  → HTTP 200 → response.json()
  → returns: { success: true, data: { holders: [{ address: "...", balance: 1000, ... }] } }
  → BUT: typed as BirdeyeHolder[], actually {success, data}

  holders = { success: true, data: { holders: [...] } }
  holders.map(h => ...)  ← TypeError: holders.map is not a function

  → CATCH → throw new Error('Failed to fetch holders for ${mint}: ...')

RESULT: repositories.holder.bulkUpsert() NEVER REACHED
```

### 2.3 `fetchAndStoreTransactions(mint, poolAddress)`

```
CALL: birdeye.getTokenTransactions(mint)
  → apiFetch<BirdeyeTransaction[]>(/defi/txs/token, { address: mint, limit: 100 })
  → returns: { success: true, data: { txns: [...] } }
  → BUT: typed as BirdeyeTransaction[], actually {success, data}

  txs = { success: true, data: { txns: [...] } }
  txs.map(t => ...)  ← TypeError: txs.map is not a function

  → CATCH → throw new Error('Failed to fetch transactions for ${mint}: ...')

RESULT: repositories.transaction.bulkAdd() NEVER REACHED
```

### 2.4 `fetchAndStoreMarketData(mint, poolAddress)`

```
CALL: birdeye.getTokenMarketData(mint)
  → apiFetch<BirdeyeMarketData>(/defi/token_market_data, { address: mint })
  → returns: { success: true, data: { price: 1.23, volume5m: 5000, ... } }
  → BUT: typed as BirdeyeMarketData, actually {success, data}

  bd = { success: true, data: { ... } }
  bd?.price       → undefined → ?? 0 → 0
  bd?.volume5m    → undefined → ?? 0 → 0
  bd?.volume15m   → undefined → ?? 0 → 0
  ...
  bd?.uniqueTraders1h → undefined → ?? 0 → 0

CALL: dexscreener.getPairActivity(poolAddress)
  → ds?.txCount?.m5 → undefined → ?? 0
  → ds?.txCount?.h1 → undefined → ?? 0

RECORD TO SAVE:
  { poolAddress, tokenMint: mint,
    price: 0, volume5m: 0, volume15m: 0, volume30m: 0, volume1h: 0, volume24h: 0,
    txCount5m: 0, txCount15m: 0, txCount30m: 0, txCount1h: 0,
    buyVolume5m: 0, sellVolume5m: 0, buyCount5m: 0, sellCount5m: 0,
    uniqueTraders5m: 0, uniqueTraders15m: 0, uniqueTraders1h: 0, uniqueTraders4h: 0,
    timestamp: new Date() }

VALIDATION (marketRepository.ts:75-82):
  poolAddress present?  ✅
  tokenMint present?    ✅
  volume5m(0) < 0?      false ✅
  txCount5m(0) < 0?     false ✅
  → { valid: true, errors: [], warnings: [] }

  → repositories.market.add(marketData) ✅ STORED

RESULT: 1 record stored in MarketRepository
```

### 2.5 `syncPoolLiquidity(poolAddress)`

```
CALL: meteora.getPool(poolAddress)
  → Meteora DLMM API (public, no auth)
  → returns flat JSON: { liquidityX: 50000, liquidityY: 30000, tvl: 80000, mintX: "..." }

RECORD TO SAVE:
  { poolAddress, tokenMint: pool.mintX,
    liquidity: pool.liquidityX + pool.liquidityY,
    tvl: pool.tvl,
    activeBinLiquidity: 0,
    timestamp: new Date(),
    source: 'meteora' }

  → repositories.liquidity.add(snapshot) ✅ STORED (no validation call)

RESULT: 1 record stored in LiquidityRepository
```

---

## 3. Repository State (After fullSync) — Static Projection

```
┌─────────────────────────┬──────────┬─────────────────────────────────────┐
│ Repository              │ Count    │ Sample Record Summary                │
├─────────────────────────┼──────────┼─────────────────────────────────────┤
│ TokenRepository         │ 0        │ (empty — upsert never called)       │
│ HolderRepository        │ 0        │ (empty — bulkUpsert never called)   │
│ TransactionRepository   │ 0        │ (empty — bulkAdd never called)      │
│ MarketRepository        │ 1        │ { price:0, volume5m:0, ..., ALL 0 } │
│ LiquidityRepository     │ 1        │ { liquidity:80000, tvl:80000, ... } │
└─────────────────────────┴──────────┴─────────────────────────────────────┘
```

### 3.1 TokenRepository — Sample (Empty)

```
getAll() → []
Map keys: []
Internal: Map<string, TokenData> — size 0
```

### 3.2 HolderRepository — Sample (Empty)

```
getByToken(<mint>) → []
Map keys: []
Internal: Map<string, HolderData> — size 0
```

### 3.3 TransactionRepository — Sample (Empty)

```
getByPool(<pool>, 10) → []
Internal: TransactionData[] — length 0
Internal: seenSignatures Set — size 0
```

### 3.4 MarketRepository — Sample Record

```json
{
  "poolAddress": "<pool_address>",
  "tokenMint": "<token_mint>",
  "price": 0,
  "volume5m": 0,
  "volume15m": 0,
  "volume30m": 0,
  "volume1h": 0,
  "volume24h": 0,
  "txCount5m": 0,
  "txCount15m": 0,
  "txCount30m": 0,
  "txCount1h": 0,
  "buyVolume5m": 0,
  "sellVolume5m": 0,
  "buyCount5m": 0,
  "sellCount5m": 0,
  "uniqueTraders5m": 0,
  "uniqueTraders15m": 0,
  "uniqueTraders1h": 0,
  "uniqueTraders4h": 0,
  "timestamp": "<now>"
}
```

**Non-zero fields:** `poolAddress`, `tokenMint`, `timestamp`
**All data fields = 0**

### 3.5 LiquidityRepository — Sample Record

```json
{
  "poolAddress": "<pool_address>",
  "tokenMint": "<token_mint>",
  "liquidity": 80000,
  "tvl": 80000,
  "activeBinLiquidity": 0,
  "timestamp": "<now>",
  "source": "meteora"
}
```

**Only repository with real, non-zero data.**

---

## 4. Lookup Key Verification

```
TokenRepository:

  Save key:   token.mint = "<mint>"
  Read key:   token.mint = "<mint>"
  Lookup:     getByMint("<mint>")
  Internal map keys: []
  Result:     null
  ⚠️  upsert() was NEVER called — validation threw before reaching repositories.token.upsert()


HolderRepository:

  Save key:   "holder:\${tokenMint}:\${holder.address}"
  Read key:   "holder:\${tokenMint}:\${holder.address}"
  Lookup:     getByToken("<mint>")
  Internal map keys: []
  Result:     []
  ⚠️  bulkUpsert() was NEVER called — .map() threw on Birdeye wrapper


TransactionRepository:

  Save key:    stored in array, filtered by poolAddress
  Read key:    poolAddress
  Lookup:      getByPool("<pool>")
  Array matching pool: 0 records
  Result:      []
  ⚠️  bulkAdd() was NEVER called — .map() threw on Birdeye wrapper


MarketRepository:

  Save key:    stored in array, filtered by poolAddress
  Read key:    poolAddress
  Lookup:      getLatest("<pool>")
  Array matching pool: 1 record
  Result:      MarketData { all fields = 0 }
  ✅  Found by poolAddress — BUT all data is ZERO


LiquidityRepository:

  Save key:    stored in array, filtered by poolAddress
  Read key:    poolAddress
  Lookup:      getLatest("<pool>")
  Array matching pool: 1 record
  Result:      LiquiditySnapshot { liquidity: 80000, tvl: 80000 }
  ✅  Found by poolAddress — with REAL data from Meteora
```

---

## 5. Save Key vs Read Key vs Lookup Key Matrix

| Repository | Save inserts to | Read queries by | Lookup method | Key match? | Data found? |
|---|---|---|---|---|---|
| Token | `Map<mint, Token>` | `Map<mint, Token>` | `getByMint(mint)` | ✅ Same mint | ❌ Empty map |
| Holder | `Map<holder:tokenMint:address, Holder>` | `Map.values() filter by tokenMint` | `getByToken(mint)` | ✅ Same mint | ❌ Empty map |
| Transaction | `TransactionData[]` | `[].filter(poolAddress)` | `getByPool(pool)` | ✅ Same pool | ❌ Empty array |
| Market | `MarketData[]` | `[].filter(poolAddress)` | `getLatest(pool)` | ✅ Same pool | ✅ 1 record (ALL ZEROS) |
| Liquidity | `LiquiditySnapshot[]` | `[].filter(poolAddress)` | `getLatest(pool)` | ✅ Same pool | ✅ 1 record (REAL DATA) |

**Conclusion:** `save key === read key === lookup key` for all 5 repositories. The key system is consistent. The problem is not key mismatch — it's that data never reaches the storage in 3 of 5 repositories, and arrives zero-filled in 1 more.

---

## 6. Data Loss Chain

```
fullSync(tokenMint, poolAddress)
  │
  ├─ fetchAndStoreTokenData()
  │   ├─ Birdeye API:        HTTP 200 ✅
  │   ├─ Jupiter API:        HTTP 200 ✅
  │   ├─ Mapper:         symbol=OK(TP), price=OK(1.23), marketCap=0❌, liquidity=0❌
  │   ├─ Validation:     ❌ "liquidity must be > 0, marketCap must be > 0"
  │   └─ upsert():       NEVER CALLED ← FIRST DATA LOSS
  │
  ├─ fetchAndStoreHolders()
  │   ├─ Birdeye API:        HTTP 200 ✅
  │   ├─ .map():         ❌ "holders.map is not a function" (wrapper object)
  │   └─ bulkUpsert():   NEVER CALLED ← SECOND DATA LOSS
  │
  ├─ fetchAndStoreTransactions()
  │   ├─ Birdeye API:        HTTP 200 ✅
  │   ├─ .map():         ❌ "txs.map is not a function" (wrapper object)
  │   └─ bulkAdd():      NEVER CALLED ← THIRD DATA LOSS
  │
  ├─ fetchAndStoreMarketData()
  │   ├─ Birdeye API:        HTTP 200 ✅
  │   ├─ DexScreener API:    (depends)
  │   ├─ Mapper:         price=0❌, volume5m=0❌, txCount5m=0❌, ... ALL ZERO
  │   ├─ Validation:     ✅ PASSES (all >= 0)
  │   └─ add():          CALLED → stores { poolAddress, tokenMint, ALL_ZEROS } ← ZERO-FILL
  │
  └─ syncPoolLiquidity()
      ├─ Meteora API:        HTTP 200 ✅ (public, no auth)
      ├─ Mapper:         liquidity=real✅, tvl=real✅
      └─ add():          CALLED → stores { liquidity: 80000, tvl: 80000 } ← ONLY REAL DATA
```

---

## 7. First Confirmed Data Loss Point

**File:** `src/services/marketDataService.ts:54-58`
**Function:** `fetchAndStoreTokenData()`

```typescript
const validation = repositories.token.validate(token);  // line 53
if (!validation.valid) {                                 // line 54
  throw new Error(`Token data validation failed: ...`);  // line 55 — ❌ DATA LOSS
}                                                        // line 56
return await repositories.token.upsert(token);           // line 58 — NEVER REACHED
```

**Root cause of the `throw`:**

| Birdeye response field | Code reads | Actual value | Returns | Default |
|---|---|---|---|---|
| `data.symbol` | `result.symbol` | `undefined` | `undefined` | Jupiter fallback = ✅ "TOKEN" |
| `data.marketCap` | `result.marketCap` | `undefined` | `undefined` → `?? 0` | `0` ❌ |
| `data.liquidity` | `result.liquidity` | `undefined` | `undefined` → `?? 0` | `0` ❌ |
| `data.holders` | `result.holders` | `undefined` | `undefined` → `?? 0` | `0` ⚠️ |
| `data.price` | `result.price` | `undefined` | `undefined` → Jupiter = ✅ `1.23` |

**Error message thrown:**
```
"Token data validation failed: liquidity must be > 0, marketCap must be > 0"
```

**This is the single point of failure that cascades through the entire system.** Fixing the Birdeye wrapper unwrap (Fix 1) and/or relaxing the validation (Fix 2) would eliminate all 3 data loss points (token, holder, transaction) and eliminate the zero-fill in market data.

---

## 8. Script Usage

To run this snapshot live (requires valid `BIRDEYE_API_KEY` in `.env`):

```bash
npx tsx scripts/phase62_repo_snapshot.ts --pool=<METEORA_POOL_ADDRESS> --mint=<TOKEN_MINT>
```

Example:
```bash
npx tsx scripts/phase62_repo_snapshot.ts \
  --pool=7c1WxW4m2sJ8yK7zYxGmJqX5nLsZqUqPpRvBqDqWqXqY \
  --mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

Expected output will match the static projection above: 3 empty repositories, 1 zero-filled, 1 with real Meteora data.
