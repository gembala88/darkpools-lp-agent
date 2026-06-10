# Phase 59B — Data Source Trace

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Method:** Static code trace (DRY_RUN, observation only, no code changes)
**Root Cause Context:** Per PHASE58_ROOT_CAUSE.md — `baseIntegration.apiFetch<T>()` returns `{success, data}` wrapper unwrapped, causing 4/5 fullSync paths to fail

---

## 1. Repository Internal State (After fullSync)

### TokenRepository

| Property | Value |
|---|---|
| **Storage** | `tokens: Map<string, TokenData>` |
| **Records loaded** | 0 (`fetchAndStoreTokenData` throws: validation rejects liquidity=0, marketCap=0) |
| **Validation gate** | `liquidity <= 0 → error; marketCap <= 0 → error` |
| **Why empty** | Birdeye data wrapped in `{success, data}` → `birdeyeData?.liquidity` = undefined → `?? 0` → `0 <= 0` → validation fails → throw → upsert() never reached |

### HolderRepository

| Property | Value |
|---|---|
| **Storage** | `holders: Map<string, HolderData>` |
| **Records loaded** | 0 (`fetchAndStoreHolders` throws: `holders.map is not a function`) |
| **Why empty** | `birdeye.getTokenHolders()` returns `{success: true, data: {holders: [...]}}` → code calls `.holders.map(h => ...)` on wrapper object → `.holders` is `undefined` → `.map` not a function → throw |

### MarketRepository

| Property | Value |
|---|---|
| **Storage** | `snapshots: MarketData[]` |
| **Records loaded** | **1** (`fetchAndStoreMarketData` succeeds: validation passes on zero values) |
| **What's stored** | `{ poolAddress, tokenMint, price:0, volume5m:0, ..., txCount5m:0, ..., buyVolume5m:0, ..., timestamp: now }` |
| **Why succeeds** | Market validation only checks `volume >= 0` and `txCount >= 0`. Zero values pass. |

### LiquidityRepository

| Property | Value |
|---|---|
| **Storage** | `snapshots: LiquiditySnapshot[]` |
| **Records loaded** | **1** (`syncPoolLiquidity` calls `meteora.getPool()` — public API, no auth needed) |
| **What's stored** | `{ poolAddress, tokenMint, liquidity: pool.liquidityX+pool.liquidityY, tvl: pool.tvl, source: 'meteora', timestamp: now }` |
| **Why succeeds** | Uses `add()` directly (no validation call). Meteora DLMM API is public. |

### TransactionRepository

| Property | Value |
|---|---|
| **Storage** | `transactions: TransactionData[]` + `seenSignatures: Set<string>` |
| **Records loaded** | 0 (`fetchAndStoreTransactions` throws: `txs.map is not a function`) |
| **Why empty** | Same wrapper issue as holders — `BirdeyeTransaction[]` is actually `{success, data: {txns: [...]}}` |

---

## 2. ALPHA ENGINE DATA SOURCE TRACES

### 2.1 feeAprPredictionEngine

**File:** `src/engines/feeAprPredictionEngine.ts`

#### Repository reads

| # | Call | Returned | Default used | Missing field |
|---|---|---|---|---|
| 1 | `liquidity.getLatest(poolAddress)` | `LiquiditySnapshot \| null` → **1 record** | `tvl = 1` if null | — (Meteora works) |
| 2 | `transaction.getRecent(poolAddress, 60)` | `TransactionData[]` → **[]** (0 records) | `fees1h = 0` | ALL fields |
| 3 | `transaction.getRecent(poolAddress, 1440)` | `TransactionData[]` → **[]** (0 records) | `fees24h = 0` | ALL fields |
| 4 | `market.getLatest(poolAddress)` | `MarketData \| null` → **1 record (all zeros)** | `volumeTrend = 'stable'` | `volume1h`, `volume24h` (both 0) |
| 5 | `market.getTransactionVelocity(poolAddress)` | Returns number → **0** (single snap: `recent.length` passes but `totalTx = 0`) | `0` | `txCount5m = 0` |

#### Fallback chain for each computed value

```
tvl:
  latestLiquidity?.tvl ?? 1
  → Meteora TVL (real) ?? 1
  → real value used (Meteora API succeeded)

fees1h:
  txs1h.reduce(sum + tx.volumeUsd * 0.003, 0)
  → [] → 0

currentApr24h:
  tvl > 0 ? (fees24h / tvl) * 365 * 100 : 0
  → fees24h = 0 → 0

volumeTrend:
  calculateTrend(latestMarket.volume1h, latestMarket.volume24h / 24)
  → latestMarket.volume1h = 0, latestMarket.volume24h/24 = 0
  → previous === 0 → 'stable'

growthFactor:
  volumeTrend === 'up' ? 1.2 : volumeTrend === 'down' ? 0.8 : 1.0
  → 'stable' → 1.0

txMomentum:
  market.getTransactionVelocity(poolAddress)
  → [0 snapshots in 5min window] or [1 snap with txCount5m=0 / 5]
  → 0

momentumFactor:
  txMomentum > 0 ? 1 + min(0 * 0.05, 0.3) : 1.0
  → 1.0

predictedApr24h:
  0 * 1.0 * 1.0 = 0

baseScore:
  min(0/100 * 50, 50) = 0

consistencyScore:
  (0 > 0 && 0 > 0) ? 20 : 0 → 0

growthScore:
  'stable' → 10

momentumBonus:
  min(0, 10) → 0

FINAL SCORE: 10
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| tvl | Meteora API | ✅ YES | — |
| Recent transactions (60min) | TransactionRepository | ❌ EMPTY | 0 |
| Recent transactions (24h) | TransactionRepository | ❌ EMPTY | 0 |
| Volume 1h | MarketRepository | ❌ ALL ZEROS | 'stable' |
| Volume 24h | MarketRepository | ❌ ALL ZEROS | 'stable' |
| Transaction velocity | MarketRepository | ❌ txCount5m=0 | 0 |

---

### 2.2 liquidityUtilizationEngine

**File:** `src/engines/liquidityUtilizationEngine.ts`

#### Repository reads

| # | Call | Returned | Default used | Missing field |
|---|---|---|---|---|
| 1 | `liquidity.getLatest(poolAddress)` | **1 record** (Meteora) | `liquidity = 1, tvl = 1` if null | — |
| 2 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | `volume24h = 0` | `volume24h` was stored as 0 |

#### Fallback chain

```
liquidity:
  latestLiquidity?.liquidity ?? 1
  → Meteora liquidity (real) ?? 1
  → real value

tvl:
  latestLiquidity?.tvl ?? 1
  → Meteora TVL (real) ?? 1
  → real value

volume24h:
  latestMarket?.volume24h ?? 0
  → 0 ?? 0 → 0

volumeToLiquidity:
  0 / liquidity → 0

volumeToTvl:
  0 / tvl → 0

Early return condition:
  volumeToLiquidity < 0.01 && volumeToTvl < 0.01
  → 0 < 0.01 && 0 < 0.01 → TRUE

FINAL SCORE: 0 (REJECTED — extremely low utilization)
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| liquidity | Meteora | ✅ YES | — |
| tvl | Meteora | ✅ YES | — |
| volume24h | MarketRepository | ❌ stored as 0 | 0 |
| volume5m | MarketRepository | ❌ stored as 0 | 0 |

---

### 2.3 txMomentumEngine

**File:** `src/engines/txMomentumEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `transaction.getRecent(poolAddress, 5)` | **[]** | count = 0 |
| 2 | `transaction.getRecent(poolAddress, 10)` | **[]** | prevCount = 0 |
| 3 | `transaction.getRecent(poolAddress, 15)` | **[]** | count = 0 |
| 4 | `transaction.getRecent(poolAddress, 30)` | **[]** | count = 0 |
| 5 | `transaction.getRecent(poolAddress, 60)` | **[]** | count = 0 |

#### Fallback chain

```
txVelocity:
  count5m / 5 = 0 / 5 = 0

txAcceleration:
  count5m - max(0, prevCount) = 0 - 0 = 0

txTrend:
  count5m(0) > prevCount(0) ? 'up' : count5m(0) < prevCount(0) ? 'down' : 'stable'
  → 'stable'

Rejection gate:
  trend === 'down' && acceleration < 0
  → 'stable' && 0 < 0 → FALSE (not rejected)

baseScore:
  min(0 * 10, 50) = 0

accelBonus:
  max(0, min(0 * 5, 30)) = 0

trendBonus:
  'stable' → 10

FINAL SCORE: 10
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Recent tx count (5m) | TransactionRepository | ❌ EMPTY | 0 |
| Recent tx count (10m) | TransactionRepository | ❌ EMPTY | 0 |
| Recent tx count (15m) | TransactionRepository | ❌ EMPTY | 0 |
| Recent tx count (30m) | TransactionRepository | ❌ EMPTY | 0 |
| Recent tx count (60m) | TransactionRepository | ❌ EMPTY | 0 |

---

### 2.4 capitalInflowEngine

**File:** `src/engines/capitalInflowEngine.ts`

#### Repository reads (repeated for 3 timeframes: 30, 60, 240)

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `holder.getByToken(tokenMint)` | **[]** | wallets = [] |
| 2 | `transaction.getRecent(poolAddress, T)` | **[]** | volume = 0 |
| 3 | `liquidity.getAggregated(poolAddress, T)` | **`{0,0,0,0}`** (< 2 snaps in window) | change = 0 |

Total reads: 3 calls × 3 timeframes = **9 repository reads**

#### Fallback chain

```
getNewWallets(tokenMint, minutes):
  holders.filter(h => h.firstSeen >= cutoff).length
  → [].filter(...).length = 0

getNewVolume(poolAddress, minutes):
  txs.reduce(sum + tx.volumeUsd, 0)
  → [].reduce(...) = 0

getNewLiquidity(poolAddress, minutes):
  max(0, aggregated.change)
  → max(0, 0) = 0

hasInflow:
  (0 > 0 || 0 > 0 || 0 > 0) → FALSE

FINAL SCORE: 0 (REJECTED — No capital inflow detected)
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Holders by token | HolderRepository | ❌ EMPTY | [] |
| Recent transactions | TransactionRepository | ❌ EMPTY | [] |
| Liquidity change (30m) | LiquidityRepository | ❌ 1 snap total | {0,0,0,0} |
| Liquidity change (60m) | LiquidityRepository | ❌ 1 snap total | {0,0,0,0} |
| Liquidity change (4h) | LiquidityRepository | ❌ 1 snap total | {0,0,0,0} |

---

### 2.5 liquidityStabilityEngine

**File:** `src/engines/liquidityStabilityEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `liquidity.getAggregated(poolAddress, 30)` | **`{0,0,0,0}`** | changePercent = 0 |
| 2 | `liquidity.getAggregated(poolAddress, 60)` | **`{0,0,0,0}`** | changePercent = 0 |
| 3 | `liquidity.getAggregated(poolAddress, 240)` | **`{0,0,0,0}`** | changePercent = 0 |

#### Fallback chain

```
liquidity.getAggregated():
  getHistory(poolAddress, interval, now)
  → [1 snapshot in range] → length=1 → length < 2 → RETURN {0,0,0,0}

worstDrain:
  Math.min(0, 0, 0) = 0

Critical drain check:
  0 < -40 → FALSE (all 3 timeframes) → not rejected

totalLiquidity:
  0 + 0 + 0 = 0

stabilityBonus:
  worstDrain(0) > -5 → TRUE → 30

growthScore:
  max(0, 0 * 0.5) + 30 = 30

FINAL SCORE: 30
```

NOTE: The only reason this engine returns a non-zero score is because all changePercent values are exactly 0 (due to insufficient snapshots), so `worstDrain = 0 > -5 → stabilityBonus = 30`. This 30 is purely an artifact of "no data available" — not an actual measure of stability.

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Liquidity history (30m) | LiquidityRepository | ❌ 1 snap (< 2 needed) | {0,0,0,0} |
| Liquidity history (60m) | LiquidityRepository | ❌ 1 snap (< 2 needed) | {0,0,0,0} |
| Liquidity history (4h) | LiquidityRepository | ❌ 1 snap (< 2 needed) | {0,0,0,0} |

---

### 2.6 smartMoneyConvictionEngine

**File:** `src/engines/smartMoneyConvictionEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `holder.getByToken(tokenMint)` | **[]** | holders = [] |
| 2 | `holder.getByToken(tokenMint)` (inside calculateAvgHoldDuration) | **[]** (duplicate read) | durations = [] |
| 3 | `transaction.getSmartMoneyTransactions(poolAddress, 1440)` | **[]** | reEntryFreq = 0 |

#### Fallback chain

```
holders:
  getByToken(tokenMint) → []

smartHolders:
  [].filter(h => tags.some(...)) → []

smartWalletCount: 0
smartWalletTotalPct: 0

calculateAvgHoldDuration:
  getByToken → [] → length === 0 → return 0

reEntryFreq:
  getSmartMoneyTransactions → [] → length = 0

walletCountScore:
  min(0 * 15, 30) = 0

concentrationScore:
  min(0 * 2, 30) = 0

holdDurationScore:
  min(0 / (3600*1000), 20) = 0

reEntryScore:
  min(0 * 2, 20) = 0

FINAL SCORE: 0
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| All holders | HolderRepository | ❌ EMPTY | [] |
| Smart money tags | HolderRepository | ❌ EMPTY | [] |
| Smart money transactions | TransactionRepository | ❌ EMPTY | [] |

---

### 2.7 smartLPEngine

**File:** `src/engines/smartLPEngine.ts`

#### Repository reads

**NONE.** This engine uses only internal state and params.

| # | Access | Location | Value |
|---|---|---|---|
| 1 | `this.trackedWallets` | Class field | `[]` (never populated externally) |
| 2 | `this.knownSuccessfulWallets` | Class field | `Set<string>()` (empty) |

#### Fallback chain

```
activeLPs:
  params?.activeLPs ?? []
  → undefined → []

matchingWallets:
  [].filter(w => activeLPs.includes(w.address)) → []

matchingWallets.length === 0 → EARLY RETURN

FINAL SCORE: 0
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Tracked LP wallets | Internal `trackedWallets[]` | ❌ NEVER POPULATED | [] |
| Active LPs for pool | params | ❌ not provided | [] |

---

### 2.8 rangeEfficiencyEngine

**File:** `src/engines/rangeEfficiencyEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | `volume24h = 0` |
| 2 | `liquidity.getLatest(poolAddress)` | **1 record (Meteora)** | `tvl = 1` if null |
| 3 | `transaction.getRecent(poolAddress, 60)` | **[]** | feesGenerated = 0 |

#### Fallback chain (requires activeBin/lowerBin/upperBin params)

```
Early return:
  !poolAddress || activeBin == null || lowerBin == null || upperBin == null
  → TRUE if position data not provided

  FINAL SCORE: 0 (Missing position data)
```

**If position data IS provided:**

```
totalBins = upperBin - lowerBin
inRange = activeBin >= lowerBin && activeBin <= upperBin

volume24h:
  latestMarket?.volume24h ?? 0 → 0

tvl:
  latestLiquidity?.tvl ?? 1 → Meteora TVL or 1

capitalEfficiency:
  0 / tvl = 0

feesGenerated:
  [].reduce(...) = 0

feeEfficiency:
  0 / tvl = 0

rangeScore:
  inRange ? 30 : max(0, 30 - movement * 30) → depends on position data
  (typically 30 if in range)

capitalScore:
  min(0 * 10, 30) = 0

feeScore:
  min(0 * 100, 25) = 0

widthScore:
  totalBins >= 35 && <= 200 ? 15 : > 200 ? 5 : 10
  → depends on user params

FINAL SCORE: 30-45 (rangeScore + widthScore, depends on position)
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| volume24h | MarketRepository | ❌ stored as 0 | 0 |
| tvl | Meteora API | ✅ YES | — |
| Recent transactions | TransactionRepository | ❌ EMPTY | [] |
| activeBin/lowerBin/upperBin | Engine params | ❌ not provided | 0 (early return) |

---

### 2.9 holderGrowthEngine

**File:** `src/engines/holderGrowthEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `holder.getByToken(tokenMint)` | **[]** | holders = [] |

#### Fallback chain

```
holders:
  getByToken(tokenMint) → []

recent1h:
  [].filter(h => h.firstSeen >= cutoff) → []

totalHolders: 0
newHolders1h: 0
newHolders4h: 0
newHolders24h: 0

growth1h:
  0 > 0 ? (0 / 0) * 100 : 0 → 0

growth4h:
  0 > 0 ? (0 / 0) * 100 : 0 → 0

growthScore:
  0 * 0.6 + 0 * 0.4 → 0

totalBonus:
  min(0/100, 20) = 0

FINAL SCORE: 0
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| All holders | HolderRepository | ❌ EMPTY | [] |
| Holder firstSeen dates | HolderRepository | ❌ EMPTY | N/A |

---

### 2.10 narrativeEngineV2

**File:** `src/engines/narrativeEngineV2.ts`

#### Repository reads

**NONE.** This engine uses only params.

| # | Access | Location | Value |
|---|---|---|---|
| 1 | `params.tokenName` | Engine params | `undefined` (unless provided) |
| 2 | `params.tokenSymbol` | Engine params | `undefined` (unless provided) |
| 3 | `params.narrative` | Engine params | `undefined` (unless provided) |

#### Fallback chain

```
textToAnalyze:
  [tokenName, tokenSymbol, narrative].filter(Boolean).join(' ')
  → '' (all undefined) → ''

!textToAnalyze → EARLY RETURN → score = 0

FINAL SCORE: 0 (No token info to analyze)
```

**With tokenSymbol='USDC':**
```
textToAnalyze = 'USDC'.toLowerCase() = 'usdc'

Keyword match check:
  → no narrative keywords contain 'usdc'
  → totalScore = 0

FINAL SCORE: 0
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| tokenName | Engine params | ❌ not provided | '' |
| tokenSymbol | Engine params | ❌ not provided | '' |
| narrative | Engine params | ❌ not provided | '' |

---

### 2.11 riskEngineV2

**File:** `src/engines/riskEngineV2.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `holder.getByToken(tokenMint)` | **[]** | holders = [] |
| 2 | `holder.getConcentration(tokenMint)` | **0** (`holders.length === 0 → return 0`) | top10Concentration = 0 |

#### Fallback chain

```
holders:
  getByToken(tokenMint) → []

top10Concentration:
  getConcentration(tokenMint)
  → getTopHolders(tokenMint, 10) → []
  → holders.length === 0 → return 0

bundlerScore:
  detectBundlers(top10)
  → top10 = sortedByBalance.slice(0, 10) = []
  → topHolders.length < 3 → return 0

tokenAgeHours: params?.tokenAgeHours ?? 0
marketCap: params?.marketCap ?? 0

riskScore = 100
  - 0 (top10Concentration=0, no deduction)
  - 0 (bundlerScore=0, no deduction)
  - 15 (holders.length=0 < 100)
  - 20 (tokenAgeHours=0 < 2)
  - 15 (marketCap=0 < 100000)
  = 50

rugProbability:
  0 + 0 + 0.2(age<2) + 0.2(holders<200) = 0.4

rug > 0.7? 0.4 > 0.7 → FALSE → no cap
rug > 0.4? 0.4 > 0.4 → FALSE (strict >) → no deduction

FINAL SCORE: 50
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| All holders | HolderRepository | ❌ EMPTY | [] |
| Holder concentration | HolderRepository (computed) | ❌ EMPTY | 0 |
| Token age hours | Engine params | ❌ default | 0 |
| Market cap | Engine params | ❌ default | 0 |

---

### 2.12 lpMomentumEngine

**File:** `src/engines/lpMomentumEngine.ts`

This engine runs **7 sub-evaluations** internally, each making its own repository reads.

#### Total repository reads

| # | Sub-evaluation | Call | Returned | Default |
|---|---|---|---|---|
| 1 | evaluateFeeTvlRatio | `liquidity.getLatest(poolAddress)` | 1 record | tvl=1 |
| 2 | evaluateFeeTvlRatio | `transaction.getRecent(poolAddress, 60)` | [] | fees=0 |
| 3 | evaluateVolumeAcceleration | `transaction.getRecent(poolAddress, 5)` | [] | vol=0 |
| 4 | evaluateVolumeAcceleration | `transaction.getRecent(poolAddress, 15)` | [] | vol=0 |
| 5 | evaluateVolumeAcceleration | `transaction.getRecent(poolAddress, 30)` | [] | vol=0 |
| 6 | evaluateVolumeAcceleration | `transaction.getRecent(poolAddress, 60)` | [] | vol=0 |
| 7 | evaluateTxMomentum | `transaction.getRecent(poolAddress, 5)` | [] | count=0 |
| 8 | evaluateTxMomentum | `transaction.getRecent(poolAddress, 15)` | [] | count=0 |
| 9 | evaluateTxMomentum | `transaction.getRecent(poolAddress, 30)` | [] | count=0 |
| 10 | evaluateTxMomentum | `transaction.getRecent(poolAddress, 60)` | [] | count=0 |
| 11 | evaluateLiquidityStability | `liquidity.getAggregated(poolAddress, 30)` | {0,0,0,0} | drain=0 |
| 12 | evaluateLiquidityStability | `liquidity.getAggregated(poolAddress, 60)` | {0,0,0,0} | drain=0 |
| 13 | evaluateLiquidityStability | `liquidity.getAggregated(poolAddress, 240)` | {0,0,0,0} | drain=0 |
| 14 | evaluateCapitalInflow | `transaction.getRecent(poolAddress, 30)` | [] | vol=0 |
| 15 | evaluateCapitalInflow | `transaction.getRecent(poolAddress, 60)` | [] | vol=0 |
| 16 | evaluateCapitalInflow | `holder.getByToken(tokenMint)` | [] | holders=[] |
| 17 | evaluateCapitalInflow | `liquidity.getAggregated(poolAddress, 60)` | {0,0,0,0} | newLiq=0 |
| 18 | evaluateHolderGrowth | `holder.getByToken(tokenMint)` | [] | holders=[] |

**Total: 18 repository reads** (most are redundant/duplicates)

#### Sub-evaluation scores

| Sub-eval | Compute path | Score |
|---|---|---|
| **feeTvlRatio** | `txs1h=[]` → `fees=0` → `feeTvlRatio=0` → `0 > 0?` No → `return 10` | **10** |
| **volumeAcceleration** | All vol=0 → All growth=0 → `avgGrowth=0` → `0>=100?` No → ... → `return 0` | **0** |
| **txMomentum** | All counts=0 → velocities=0 → accel=0 → `velScore=0`, `accelScore=10`, `trendScore=5` → **15** | **15** |
| **priceChange** | No priceChanges → `!priceChanges || length<2` → **return 50** | **50** |
| **liquidityStability** | All drains=0 → `drain30m>0?` No → `drain30m>-5?` Yes(0) AND `drain1h>-5?` Yes → **return 85** | **85** |
| **capitalInflow** | All 0 → `score=0` | **0** |
| **holderGrowth** | `holders.length === 0 → return 0` | **0** |

#### Final score computation

```
rawScore = 10×0.25 + 0×0.20 + 15×0.15 + 50×0.15 + 85×0.10 + 0×0.10 + 0×0.05
         = 2.50  + 0.00  + 2.25  + 7.50  + 8.50  + 0.00  + 0.00
         = 20.75

FINAL SCORE: 21 (normalize [0,100])
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| tvl | Meteora | ✅ YES | — |
| Recent txs (all timeframes) | TransactionRepository | ❌ EMPTY | 0/[] |
| Holders by token | HolderRepository | ❌ EMPTY | [] |
| Price changes | Params | ❌ not provided | 50 (default) |
| Liquidity aggregation (all windows) | LiquidityRepository | ❌ 1 snap total | {0,0,0,0} |

---

## 3. AI ENGINE DATA SOURCE TRACES

### 3.1 marketRegimeEngine

**File:** `src/ai/marketRegimeEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | price=0, volume24h=0, txCount5m=0, txCount1h=0 |
| 2 | `liquidity.getLatest(poolAddress)` | **1 record (Meteora)** | tvl=0 if null |
| 3 | `transaction.getBuySellCount(poolAddress, 5)` | **`{buys: 0, sells: 0}`** | recentTotal=0, buyPressure=0.5 |

#### Fallback chain

```
price: 0
volume24h: 0
txCount5m: 0
txCount1h: 0
tvl: Meteora TVL or 0

recentBuys: 0, recentSells: 0
recentTotal: 0
buyPressure: 0 > 0 ? 0/0 : 0.5 → 0.5 (HARDCODED: .5)

volumeSpike: 0 > 0 && tvl > 0 ? 0/tvl : 0 → 0
txVelocity: 0/5 = 0

Regime determination chain:
  volumeSpike(0) > 6? No
  buys 0.55, volume > 3, buy... all false
  buyPressure(0.5) > 0.55? No
  buyPressure(0.5) < 0.4? No
  txVelocity(0) > 2? No
  → FALLS THROUGH to: "low activity, no directional bias"
    → regime: RANGING (HARDCODED), score: 45 (HARDCODED)

FINAL SCORE: 45
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| price | MarketRepository | ❌ stored as 0 | 0 |
| volume24h | MarketRepository | ❌ stored as 0 | 0 |
| txCount5m | MarketRepository | ❌ stored as 0 | 0 |
| txCount1h | MarketRepository | ❌ stored as 0 | 0 |
| tvl | Meteora | ✅ YES | — |
| Recent buy/sell counts | TransactionRepository | ❌ EMPTY | {0,0} → 0.5 ratio |

---

### 3.2 poolActivityEngine

**File:** `src/ai/poolActivityEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | ALL fields = 0 |
| 2 | `liquidity.getLatest(poolAddress)` | **1 record (Meteora)** | tvl=0 if null |
| 3 | `transaction.getRecent(poolAddress, 15)` | **[]** | recentTxs = 0 |

#### Fallback chain

```
tx5m: 0, tx15m: 0, tx1h: 0
volume5m: 0, volume1h: 0
uniqueTraders5m: 0
tvl: Meteora TVL or 0

txVelocity5m: 0/5 = 0
txVelocity1h: 0/60 = 0
volumeVelocity: 0 > 0 ? 0/5 : 0 = 0
traderActivity: 0

recentTxs (from transaction.getRecent): 0

Activity level determination chain:
  0 > 6? No
  0 > 2? No
  0 > 0.5? No
  0 > 0.05? No
  → FALLS THROUGH to: DEAD → score: 5 (HARDCODED)

FINAL SCORE: 5
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| tx count 5m | MarketRepository | ❌ stored as 0 | 0 |
| volume 5m | MarketRepository | ❌ stored as 0 | 0 |
| unique traders 5m | MarketRepository | ❌ stored as 0 | 0 |
| tvl | Meteora | ✅ YES | — |
| Recent tx data | TransactionRepository | ❌ EMPTY | [] → 0 |

---

### 3.3 accumulationDetector

**File:** `src/ai/accumulationDetector.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | price=0 |
| 2 | `transaction.getRecent(poolAddress, 5)` | **[]** | buys=[], sells=[] |
| 3 | `holder.getTopHolders(tokenMint, 5)` | **[]** | concentration=0, active=0 |

#### Fallback chain

```
price: 0

buys: [], sells: []
buyTxCount: 0, sellTxCount: 0
totalTx: 0
txRatio: 0 > 0 ? 0/0 : 0.5 → 0.5
buyVol: 0, sellVol: 0
volRatio: (0+0)>0 ? 0/(0+0) : 0.5 → 0.5

smartMoneyBuys: 0, smartMoneySells: 0
netSmartMoney: 0

topHolders: []
topHolderConcentration: 0
activeTopHolders: 0

Score determination:
  txRatio(0.5) > 0.65? No
  txRatio(0.5) > 0.6? No
  txRatio(0.5) > 0.55? No
  txRatio(0.5) < 0.4? No
  txRatio(0.5) < 0.45? No
  → FALLS THROUGH to: "neutral accumulation signal"
  → score remains 50 (HARDCODED initial value)

Top holder bonus:
  topHolderConcentration(0) > 40? No → no bonus

FINAL SCORE: 50
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| price | MarketRepository | ❌ stored as 0 | 0 |
| Recent txs (5m) | TransactionRepository | ❌ EMPTY | [] |
| Top 5 holders | HolderRepository | ❌ EMPTY | [] |

---

### 3.4 whaleExitProbabilityEngine

**File:** `src/ai/whaleExitProbabilityEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | price=0 (not used!) |
| 2 | `transaction.getRecent(poolAddress, 60)` | **[]** | all txs = [] |
| 3 | `holder.getTopHolders(tokenMint, 5)` | **[]** | top5Concentration = 0 |
| 4 | `holder.getTopHolders(tokenMint, 10)` | **[]** | top10Concentration = 0 |

#### Fallback chain

```
top5Holders: []
top10Holders: []
top5Concentration: 0
top10Concentration: 0

Recent txs: []
whaleSells: [].filter(...) → []
whaleSellVolume: 0
totalSellVolume: 0
topHolderSells: 0 (no holders to check)
buyVol: 0

exitProbability = 0 (all checks fail since all inputs are 0)
  top5Concentration(0) >= 35? No
  topHolderSells(0) >= 3? No
  totalSellVolume(0) > 0? No
  totalSellVolume(0) > 50000? No
  buyVol(0) comparison: No
  top10Concentration(0) >= 60? No

FINAL SCORE: 100 - 0 = 100
```

**KEY INSIGHT:** Empty repositories produce the MAXIMUM possible score (100) for this engine because no risk indicators exist. The engine interprets "no data" as "perfectly safe" — a false negative for risk detection.

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Recent txs (60m) | TransactionRepository | ❌ EMPTY | [] |
| Top 5 holders | HolderRepository | ❌ EMPTY | [] |
| Top 10 holders | HolderRepository | ❌ EMPTY | [] |

---

### 3.5 smartMoneyFlowEngine

**File:** `src/ai/smartMoneyFlowEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `transaction.getRecent(poolAddress, 60)` | **[]** | all fields = 0 |

#### Fallback chain

```
recentTxs: []
smartMoneyTxs: []
smBuys: [], smSells: []
smBuyCount: 0, smSellCount: 0
smBuyVolume: 0, smSellVolume: 0
smTotalTx: 0
smTxRatio: 0 > 0 ? 0/0 : 0.5  (HARDCODED: .5)
smVolRatio: 0 > 0 ? 0/0 : 0.5  (HARDCODED: .5)
netSmartMoneyFlow: 0
uniqueBuyers: 0, uniqueSellers: 0
allTxCount: 0
smartMoneyShare: 0 > 0 ? 0/0 : 0 → 0

Score determination:
  smTxRatio(0.5) > 0.7? No
  smTxRatio(0.5) > 0.6? No
  smTxRatio(0.5) > 0.55? No
  smTxRatio(0.5) < 0.35? No
  smTxRatio(0.5) < 0.45? No (0.5 > 0.45)
  → No conditions matched → score stays 50 (HARDCODED initial)

  smartMoneyShare(0) > 0.3? No → no bonus

FINAL SCORE: 50
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Recent txs (60m) | TransactionRepository | ❌ EMPTY | [] |

---

### 3.6 candleIntelligenceEngine

**File:** `src/ai/aiCandleIntelligenceEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | ALL fields = 0 |

#### Fallback chain

```
price: 0
volume5m: 0
volume15m: 0
volume30m: 0
volume1h: 0
buyVolume5m: 0
sellVolume5m: 0
txCount5m: 0

volumeTrend:
  calculateTrend(volume5m=0, volume15m=0)
  → previous(0) === 0 → 'stable'

volRatio:
  (0+0) > 0 ? 0/(0+0) : 0.5  (HARDCODED: .5)

txPerVolume:
  0 > 0 ? 0/0 : 0  (HARDCODED: 0)

priceChanges:
  undefined → priceChanges check fails → entire price-based block skipped

FINAL SCORE: 50 (no conditions matched, default score)
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| price | MarketRepository | ❌ stored as 0 | 0 |
| volume 5m | MarketRepository | ❌ stored as 0 | 0 |
| buy/sell volumes | MarketRepository | ❌ stored as 0 | 0 |
| txCount5m | MarketRepository | ❌ stored as 0 | 0 |
| priceChanges | Params | ❌ not provided | N/A (block skipped) |

---

### 3.7 marketPsychologyEngine

**File:** `src/ai/marketPsychologyEngine.ts`

#### Repository reads

| # | Call | Returned | Default used |
|---|---|---|---|
| 1 | `market.getLatest(poolAddress)` | **1 record (all zeros)** | price=0 (used only in metadata) |
| 2 | `transaction.getRecent(poolAddress, 60)` | **[]** | buyVol=0, sellVol=0 |

#### Fallback chain

```
price: 0

buyVol: 0, sellVol: 0
totalVol: 0
buyRatio: 0 > 0 ? 0/0 : 0.5  (HARDCODED: .5)

buyCount: 0, sellCount: 0
txTotal: 0
txBuyRatio: 0 > 0 ? 0/0 : 0.5  (HARDCODED: .5)

avgBuySize: 0 > 0 ? 0/0 : 0  (HARDCODED: 0)
avgSellSize: 0 > 0 ? 0/0 : 0  (HARDCODED: 0)
sizeRatio: 0 > 0 ? 0/0 : 1  (HARDCODED: 1)

Psychology determination:
  buyRatio(0.5) > 0.48 && buyRatio(0.5) < 0.52  → TRUE
  txBuyRatio(0.5) > 0.45 && txBuyRatio(0.5) < 0.55  → TRUE
  → "balanced market psychology" → NEUTRAL → score: 50 (HARDCODED)

FINAL SCORE: 50
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Recent txs (60m) | TransactionRepository | ❌ EMPTY | [] |
| price | MarketRepository | ❌ stored as 0 | 0 |

---

### 3.8 selfLearningEngine

**File:** `src/ai/selfLearningEngine.ts`

#### Repository reads

**NONE.** Uses only internal state.

| # | Access | Location | Value |
|---|---|---|---|
| 1 | `this.outcomes` | Class field | `[]` (never populated) |

#### Fallback chain

```
outcomes.length (0) < 5 → EARLY RETURN

FINAL SCORE: 50 (HARDCODED: "Insufficient data for learning")
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Historical outcomes | Internal `outcomes[]` | ❌ NEVER POPULATED | [] |

---

### 3.9 deploymentMemoryEngine

**File:** `src/ai/deploymentMemoryEngine.ts`

#### Repository reads

**NONE.** Uses only internal state.

| # | Access | Location | Value |
|---|---|---|---|
| 1 | `this.deployHistory` | Class field | `[]` (never populated) |
| 2 | `this.patterns` | Class field | `[]` (never populated) |

#### Fallback chain

```
deployHistory.length (0) < 3 → EARLY RETURN

currentScore: params?.currentScore ?? 50
  → passed from LPIntelligenceService: alphaResult.score ≈ 8.48

FINAL SCORE: 8.48 (HARDCODED return: currentScore, no historical adjustment)
```

#### Data missing breakdown

| Required data point | Source | Available? | Fallback used |
|---|---|---|---|
| Deployment history | Internal `deployHistory[]` | ❌ NEVER POPULATED | [] |
| Historical patterns | Internal `patterns[]` | ❌ NEVER POPULATED | [] |
| currentScore | Engine params | ✅ from alpha engine | 50 (if not provided) |

---

## 4. Ensemble Data Flow

### 4.1 Dynamic Weights

```
marketRegime: 'RANGING' (input to dynamicWeightEngine)
  → uses RANGING regime overrides
  → poolActivity: 0.20, accumulation: 0.20, marketRegime: 0.10
  → normalized to sum = 1.0

NO repository reads
```

### 4.2 Analyst Layer

```
Input:
  engineResults (9 AI engines with scores above)
  weights (from dynamicWeightEngine)

Computation:
  weightedScore = Σ(score × weight) / totalWeight
  = 42.14

NO repository reads — pure mathematical combination of inputs
```

### 4.3 Multi-Agent System

```
Input:
  engineResults (9 AI engines with scores above)

Computation:
  Each agent filters relevant engines, averages, applies bias, aggregates

NO repository reads — pure mathematical combination of inputs
```

### 4.4 Chief AI Decision

```
Input:
  analystResult, agentResult, individual engine scores

Computation:
  baseScore = analystScore × 0.5 + agentScore × 0.3 + marketRegimeScore × 0.1 + poolActivityScore × 0.1
  riskAdjustment = -20 (poolActivity: 5 < 20, deploymentMemory: 8.48 < 35)
  finalScore = 41.76 - 20 = 21.76
  warnings = ['Pool activity too low', 'Historical patterns unfavorable']

  Action determination:
    21.76 >= 75? No
    21.76 >= 60? No
    21.76 >= 45? No
    → SKIP (HARDCODED default action at line 91)

NO repository reads — pure mathematical combination of inputs
```

---

## 5. Repository Count Summary (Before Ensemble)

| Repository | Records Loaded | Records Queried | Records Returned | Data Quality |
|---|---|---|---|---|
| **TokenRepository** | **0** | 0 by engines (no token lookups) | N/A | ❌ EMPTY |
| **HolderRepository** | **0** | ~12 by engines | [] → 0 everywhere | ❌ EMPTY |
| **MarketRepository** | **1** (all zeros) | ~8 by engines | All fields = 0 | ❌ ZERO-FILLED |
| **LiquidityRepository** | **1** (Meteora) | ~12 by engines | 1 snapshot (real TVL/liq) | ⚠️ SINGLE SNAP |
| **TransactionRepository** | **0** | ~25 by engines | [] → 0 everywhere | ❌ EMPTY |

**Total repository reads across all engines:** ~57
**Total records returned (non-zero):** 2 (1 market all-zeros, 1 liquidity real)
**Total records with meaningful data:** 1 (Meteora liquidity snapshot)

---

## 6. Hardcoded Default Detection

| Value | Occurrence | Location | Context |
|---|---|---|---|
| **50** | ~15+ | `marketRegimeEngine` line 19, `accumulationDetector` line 53, `smartMoneyFlow` line 43, `candleIntelligence` line 39, `marketPsychology` line 44, `selfLearning` line 33, `riskEngineV2` catch default, `lpMomentumEngine` priceChange default, `multiAgent` line 34/50, `analyst` line 31, most `return { score: 50, ... }` branches | Primary "no data" default score |
| **50** | 1 | `riskEngineV2` result | Computed result that happens to equal 50 |
| **8.48** | 0 | NOT hardcoded | **Result of weighted calculation** — the ~7.55-8.48 uniform score is an emergent property of the weight formula with all-zero inputs, not a literal constant |
| **7.5** | 0 | NOT hardcoded | Same as above — emergent, not a constant |
| **8.0** | 0 | NOT hardcoded | Same as above — emergent, not a constant |
| **100** | 1 | `chiefAiDecisionSystem` line 33 | `const whaleExitScore = Number(params?.whaleExitScore ?? 100);` — defaults to 100 when whale exit engine result is missing |
| **RANGING** | 2 | `marketRegimeEngine` line 40, `LPIntelligenceService` line 133 | Default market regime when data insufficient |
| **RANGING** | 2 | `dynamicWeightEngine` line 48, `deploymentMemoryEngine` line 26 | `(params?.marketRegime as MarketRegime) ?? 'RANGING'` |
| **SKIP** | 1 | `chiefAiDecisionSystem` line 91 | `let action = 'SKIP'` — default action when no conditions met |
| **0.5** | ~10 | Various AI engines | `total > 0 ? buys/total : 0.5` pattern — neutral ratio default |
| **0** | ~20 | Various | Default score/field value throughout |

### Key finding: The uniform score is NOT hardcoded

The observed uniform scores (~7.55 per original report, ~8.48 per our trace) are **emergent calculations** from the weight formula:

```
rawScore = Σ(score_i × weight_i)
         = 10×0.18 + 0×0.14 + 10×0.09 + 0×0.09 + 30×0.09 + 0×0.09 + 0×0.09 + 0×0.04 + 0×0.04 + 0×0.03 + 50×0.02 + 21×0.10
         = 8.475
```

Every engine returns the SAME score for every pool (since all repositories produce identical empty/zero results), and the weighted formula produces the same ~8.48 for every pool. No literal `7.5` or `8.0` constant exists in the code — the exact value depends on which engines produce non-zero defaults and their weights.

---

## 7. Root Cause Recap

The chain of missing data begins at `baseIntegration.apiFetch<T>()` at `src/integrations/baseIntegration.ts:51`:

```
line 51: return await response.json() as T;
```

Birdeye response:
```json
{ "success": true, "data": { "symbol": "USDC", "price": 1.00, ... } }
```

Returned object (typed as `BirdeyeTokenOverview`):
```json
{ "success": true, "data": { "symbol": "USDC", ... } }
```

Code reads: `result.symbol` → `undefined` (should be `result.data.symbol`)

**Result:** Every Birdeye-dependent field across every engine's data source reads `undefined`, triggering `?? <default>`. This causes the cascading failure documented in Phase 58.
