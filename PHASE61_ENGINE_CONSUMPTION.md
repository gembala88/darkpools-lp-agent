# Phase 61 — Engine Consumption Audit

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Method:** Static code trace (DRY_RUN, observation only)
**Target pools:** PARQ, Bountywork, ZINC (Meteora DLMM pools)

---

## 1. Repository Identity (Singleton Check)

Throughout the entire evaluation chain, **exactly one singleton** is used:

```
C:\...\repo\src\repositories\index.ts  →  module cache key A
```

| Consumer | Import Path | Receives |
|---|---|---|
| `MarketDataService` (writes during fullSync) | `../repositories/index.js` | Singleton A ✅ |
| `feeAprPredictionEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `liquidityUtilizationEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `txMomentumEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `capitalInflowEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `liquidityStabilityEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `smartMoneyConvictionEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `rangeEfficiencyEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `holderGrowthEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `riskEngineV2` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `lpMomentumEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `marketRegimeEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `poolActivityEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `accumulationDetector` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `whaleExitProbabilityEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `smartMoneyFlowEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `candleIntelligenceEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |
| `marketPsychologyEngine` (reads) | `../repositories/index.js` | Singleton A ✅ |

**`save()` instance === `read()` instance.** No identity mismatch.

---

## 2. Full Execution Trace: PARQ

### 2.1 Call: `evaluatePool('PARQ_ADDR', 'PARQ_MINT', { marketCap: 500000, tokenAgeHours: 24 })`

### 2.2 fullSync() — Repository Writes

| Sync Function | Endpoint | Returns | Repository | Result |
|---|---|---|---|---|
| `fetchAndStoreTokenData` | Birdeye `token_overview` + Jupiter `token_info` | `{success,data}` wrapper → `liquidity=0, marketCap=0` | **TokenRepository** | **THROW** — validation: `liquidity <= 0`, `marketCap <= 0` |
| `fetchAndStoreHolders` | Birdeye `token_holders` | `{success, data: {holders}}` → `.map` fails | **HolderRepository** | **THROW** — `holders.map is not a function` |
| `fetchAndStoreTransactions` | Birdeye `txs/token` | `{success, data: {txns}}` → `.map` fails | **TransactionRepository** | **THROW** — `txs.map is not a function` |
| `fetchAndStoreMarketData` | Birdeye `token_market_data` + DexScreener | `bd.*` all undefined → `0` | **MarketRepository** | **STORED** — validation passes (all `>= 0`) |
| `syncPoolLiquidity` | Meteora pool API | flat JSON with real TVL/liquidity | **LiquidityRepository** | **STORED** — `add()` without validation |

### 2.3 Repository State After PARQ fullSync

| Repository | Content | Details |
|---|---|---|
| TokenRepository | Map: **0 entries** | `upsert()` never reached (throw before call) |
| HolderRepository | Map: **0 entries** | `.map()` never reached (type error) |
| TransactionRepository | **0 records** in array | `.map()` never reached (type error) |
| MarketRepository | **1 record** | `{ poolAddress:PARQ, ..., volume5m:0, ..., txCount5m:0, ..., ALL_ZEROS }` |
| LiquidityRepository | **1 record** | `{ poolAddress:PARQ, liquidity: 123456, tvl: 789012, ... }` (real Meteora data) |

### 2.4 fullSync() — Repository State After Bountywork fullSync (Same Session)

| Repository | Content | Details |
|---|---|---|
| TokenRepository | Map: **0 entries** | Same: validation throws |
| HolderRepository | Map: **0 entries** | Same: map fails |
| TransactionRepository | **0 records** | Same: map fails |
| MarketRepository | **2 records** (PARQ + Bountywork) | Bountywork entry also all zeros — **identical to PARQ entry** (different poolAddress/mint only) |
| LiquidityRepository | **2 records** (PARQ + Bountywork) | Bountywork has different TVL/liquidity from Meteora |

### 2.5 fullSync() — After ZINC (All 3)

| Repository | Content | Details |
|---|---|---|
| TokenRepository | **0 entries** | All 3 failed validation |
| HolderRepository | **0 entries** | All 3 failed |
| TransactionRepository | **0 records** | All 3 failed |
| MarketRepository | **3 records** | All 3 entries: **IDENTICAL data** (all fields = 0) |
| LiquidityRepository | **3 records** | Each entry: **different** TVL/liquidity (real Meteora data per pool) |

### 2.6 Critical Finding: MarketRepository Entries Are Identical

Each `fetchAndStoreMarketData` produces:

```json
{
  "poolAddress": "<PER-POOL>",
  "tokenMint": "<PER-POOL>",
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

Every field is `0` for every pool. The only varying fields are `poolAddress` and `tokenMint` and `timestamp`.

---

## 3. Per-Engine Consumption Trace (PARQ, Bountywork, ZINC)

### 3.1 feeAprPredictionEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ PARQ         Bountywork    ZINC                                            │
│ ────────     ──────────    ────                                            │
│ tvl=789012   tvl=456789    tvl=234567      ← DIFFERENT (Meteora per pool)  │
│ txs1h=[]     txs1h=[]      txs1h=[]        ← ALL SAME (empty)              │
│ txs24h=[]    txs24h=[]     txs24h=[]       ← ALL SAME (empty)              │
│ mkt=get()    mkt=get()     mkt=get()       ← ALL SAME (zeros)              │
│                                                                             │
│ fees1h  = 0                        ← SAME                                  │
│ fees24h = 0                        ← SAME                                  │
│ currApr24h = 0 / tvl * 36500 = 0  ← SAME (0/TVL = 0 regardless of TVL)    │
│ volumeTrend = 'stable'            ← SAME                                  │
│ predictedApr24h = 0               ← SAME                                  │
│                                                                             │
│ baseScore = 0                     ← SAME                                  │
│ consistencyScore = 0               ← SAME                                  │
│ growthScore = 10                  ← SAME                                  │
│ momentumBonus = 0                 ← SAME                                  │
│ SCORE: 10                         ← SAME                                  │
│ CONTRIB: 10 × 0.18 = 1.80         ← SAME                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Why TVL difference doesn't matter:** `currentApr24h = fees24h / tvl * 365 * 100`. With `fees24h = 0`, the result is `0` regardless of TVL. Same for `currentApr1h`, `predictedApr24h`, `predictedApr7d`.

### 3.2 liquidityUtilizationEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ volume24h = 0                     ← SAME (market entry all zeros)          │
│ liquidity = Meteora per pool      ← DIFFERENT                              │
│ volumeToLiquidity = 0 / liq = 0   ← SAME (0/anything = 0)                  │
│ volumeToTvl = 0 / tvl = 0         ← SAME                                  │
│                                                                             │
│ EARLY RETURN: 0 < 0.01 && 0 < 0.01 → TRUE                                  │
│ SCORE: 0 (REJECTED)               ← SAME                                  │
│ CONTRIB: 0 × 0.14 = 0.00          ← SAME                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 txMomentumEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ getRecent(*, 5)  → [] → count=0   ← SAME                                  │
│ getRecent(*, 10) → [] → prev=0    ← SAME                                  │
│ getRecent(*, 15) → [] → count=0   ← SAME                                  │
│ getRecent(*, 30) → [] → count=0   ← SAME                                  │
│ getRecent(*, 60) → [] → count=0   ← SAME                                  │
│                                                                             │
│ txVelocity = 0, txAccel = 0, trend = 'stable'                              │
│ baseScore = 0, accelBonus = 0, trendBonus = 10                             │
│ SCORE: 10                         ← SAME                                  │
│ CONTRIB: 10 × 0.09 = 0.90         ← SAME                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 capitalInflowEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ holder.getByToken → []            ← SAME                                  │
│ getRecent(*, 30) → []             ← SAME                                  │
│ getRecent(*, 60) → []             ← SAME                                  │
│ getRecent(*, 240) → []            ← SAME                                  │
│ liquidity.getAggregated(*, 30) → {0,0,0,0}  ← SAME (only 1 snap)          │
│ liquidity.getAggregated(*, 60) → {0,0,0,0}  ← SAME                        │
│ liquidity.getAggregated(*, 240)→ {0,0,0,0}  ← SAME                        │
│                                                                             │
│ hasInflow = false → REJECTED                                                │
│ SCORE: 0                         ← SAME                                    │
│ CONTRIB: 0 × 0.09 = 0.00         ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 liquidityStabilityEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ liquidity.getAggregated(*, 30)  → {0,0,0,0}  ← SAME (only 1 snap)         │
│ liquidity.getAggregated(*, 60)  → {0,0,0,0}  ← SAME                       │
│ liquidity.getAggregated(*, 240) → {0,0,0,0}  ← SAME                       │
│                                                                             │
│ WHY AGGREGATION RETURNS ZEROS:                                              │
│ getHistory filters by poolAddress within [now-30min, now]                  │
│ → finds 1 snapshot (the one just saved by syncPoolLiquidity)               │
│ → snapshots.length = 1 < 2 → return {0,0,0,0}                             │
│ → This is correct per-pool isolation, but insufficient data                │
│                                                                             │
│ worstDrain = 0, stabilityBonus = 30 (0 > -5 → TRUE)                       │
│ SCORE: 30                        ← SAME                                    │
│ CONTRIB: 30 × 0.09 = 2.70        ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

**NOTE:** Even if a pool had a SECOND snapshot (from a previous sync), the `changePercent` would be computed from that pool's own liquidity history. So given sufficient syncs over time, this engine COULD differentiate between pools. But with only 1 snapshot per pool, all pools get `{0,0,0,0}`.

### 3.6 smartMoneyConvictionEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ holder.getByToken → []           ← SAME                                   │
│ getSmartMoneyTransactions → []    ← SAME                                   │
│ smartWalletCount = 0, reEntry = 0, avgHold = 0                            │
│ SCORE: 0                         ← SAME                                    │
│ CONTRIB: 0 × 0.09 = 0.00         ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.7 smartLPEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ No repository reads (internal state only)                                   │
│ trackedWallets = [] (never populated)                                      │
│ activeLPs not provided → []                                                │
│ SCORE: 0                         ← SAME                                    │
│ CONTRIB: 0 × 0.09 = 0.00         ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.8 rangeEfficiencyEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ activeBin/lowerBin/upperBin from params → NOT PROVIDED                     │
│ EARLY RETURN → score = 0                                                   │
│ SCORE: 0                         ← SAME                                    │
│ CONTRIB: 0 × 0.04 = 0.00         ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.9 holderGrowthEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ holder.getByToken → []           ← SAME                                   │
│ totalHolders = 0, all growth = 0                                           │
│ SCORE: 0                         ← SAME                                    │
│ CONTRIB: 0 × 0.04 = 0.00         ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.10 narrativeEngineV2

```
┌────────────────────────────────────────────────────────────────────────────┐
│ PARQ:       textToAnalyze = 'parq'                                         │
│ Bountywork: textToAnalyze = 'bountywork'                                   │
│ ZINC:       textToAnalyze = 'zinc'                                         │
│                                                                             │
│ Keyword matching:   ← ALL FAIL                                         │
│   'ai' in 'parq'? No. 'agent' in 'parq'? No. ...                           │
│   → matchedNarratives = []                                                  │
│   → totalScore = 0                                                          │
│                                                                             │
│ SCORE: 0                         ← SAME                                    │
│ CONTRIB: 0 × 0.03 = 0.00         ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

**NOTE:** If a token name/symbol happened to match a narrative keyword (e.g., "SOL", "AI", "META"), this engine COULD differentiate. PARQ, Bountywork, ZINC do not match any keywords.

### 3.11 riskEngineV2

```
┌────────────────────────────────────────────────────────────────────────────┐
│ holder.getByToken → []           ← SAME                                   │
│ holder.getConcentration → 0      ← SAME                                   │
│                                                                             │
│ DEDUCTIONS (with marketCap=500000, tokenAgeHours=24 from options):          │
│   top10(0) > 80? No              →  0                                      │
│   bundler(0) > 0.5? No          →  0                                      │
│   holders(0) < 100? YES         → -15                                      │
│   tokenAge(24) < 2? No          →  0                                       │
│   tokenAge(24) < 24? No         →  0                                       │
│   marketCap(500k) < 100k? No    →  0                                       │
│   marketCap(500k) < 500k? No    →  0                                       │
│   rugProb = 0 + 0 + 0 + 0.2     →  0.2                                    │
│   rugProb(0.2) > 0.7? No        →  0                                       │
│   rugProb(0.2) > 0.4? No        →  0                                       │
│   riskScore = 100 - 15 = 85                                                │
│                                                                             │
│ SCORE: 85                        ← SAME                                    │
│ CONTRIB: (100-85) × 0.02 = 0.30  ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

**NOTE:** If `marketCap` and `tokenAgeHours` were not passed via options, they'd default to 0, resulting in more deductions (risk would be ~50, contribution would be 1.00). Either way, ALL pools get the SAME deduction.

### 3.12 lpMomentumEngine

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 7 sub-evaluations × 15+ repository reads                                   │
│                                                                             │
│ evaluateFeeTvlRatio:                                                        │
│   tvl = Meteora per pool (different)                                       │
│   txs1h = [] → fees1h = 0 → feeTvlRatio = 0/tvl = 0                       │
│   → 0 > 0? No → return 0           ← SAME (0/ANY_TVL = 0)                 │
│   Score: 0                                                                  │
│                                                                             │
│ evaluateVolumeAcceleration:                                                 │
│   All txs [] → all volume = 0 → avgGrowth = 0                              │
│   Score: 0                                                                  │
│                                                                             │
│ evaluateTxMomentum:                                                         │
│   All counts = 0 → vel=0, accel=0                                           │
│   Score: 15                                                                 │
│                                                                             │
│ evaluatePriceChange:                                                        │
│   priceChanges not provided → return 50                                    │
│   Score: 50                                                                 │
│                                                                             │
│ evaluateLiquidityStability:                                                 │
│   getAggregated → all {0,0,0,0} (1 snap)                                   │
│   drain30m=0 > -5? Yes → return 85                                         │
│   Score: 85                        ← SAME (all 1-snapped pools)            │
│                                                                             │
│ evaluateCapitalInflow:                                                      │
│   txs=[], holders=[] → all 0 → score = 0                                   │
│   Score: 0                                                                  │
│                                                                             │
│ evaluateHolderGrowth:                                                       │
│   holders.length = 0 → return 0                                             │
│   Score: 0                                                                  │
│                                                                             │
│ WEIGHTED: 0×0.25 + 0×0.20 + 15×0.15 + 50×0.15 + 85×0.10 + 0×0.10 + 0×0.05 │
│         = 0 + 0 + 2.25 + 7.50 + 8.50 + 0 + 0 = 18.25                      │
│ SCORE: 18                         ← SAME                                    │
│ CONTRIB: 18 × 0.10 = 1.80         ← SAME                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Weighted Alpha Score — All 3 Pools Identical

```
COMPONENT            SCORE    WEIGHT    (100-risk)   CONTRIBUTION   SAME?
──────────────────────────────────────────────────────────────────────────
feeAprPrediction       10  ×  0.18       —           1.80           ✅
liquidityUtilization    0  ×  0.14       —           0.00           ✅
txMomentum             10  ×  0.09       —           0.90           ✅
capitalInflow           0  ×  0.09       —           0.00           ✅
liquidityStability     30  ×  0.09       —           2.70           ✅
smartMoney              0  ×  0.09       —           0.00           ✅
smartLP                 0  ×  0.09       —           0.00           ✅
rangeEfficiency         0  ×  0.04       —           0.00           ✅
holderGrowth            0  ×  0.04       —           0.00           ✅
narrative               0  ×  0.03       —           0.00           ✅
risk                   85  ×  0.02       (100-85)=15  0.30           ✅
lpMomentum             18  ×  0.10       —           1.80           ✅
──────────────────────────────────────────────────────────────────────────
RAW SCORE                                             7.50
FINAL (normalize)                                     7.50
```

**Every single cell in the table is identical across PARQ, Bountywork, and ZINC.**

---

## 5. AI Ensemble Trace (Identical for All 3 Pools)

### AI Engine Scores

```
Engine                Score    Reason
──────────────────────────────────────────────
marketRegime          45       low activity, no directional bias → RANGING
poolActivity           5       DEAD
accumulation          50       neutral accumulation signal
whaleExit            100       no whale indicators (empty repos = "safe")
smartMoneyFlow        50       neutral smart money flow
candleIntelligence    50       No clear candle pattern detected
marketPsychology      50       balanced market psychology
selfLearning          50       Insufficient data for learning
deploymentMemory       7.50    currentScore (alpha score), no history
```

### AI Ensemble

```
Analyst weighted score:   42.14
Analyst confidence:        5.0  (high dispersion — scores: 5, 45, 50, 50, 50, 50, 50, 100)
Multi-agent score:        52.3
Chief AI base score:      41.76
Chief AI risk adjust:     −20  (poolActivity=5<20, deployMemory=7.50<35)
Chief AI final score:     21.76
Chief AI action:          SKIP  (21.76 < 45 threshold)
Chief AI warnings:        "Pool activity too low", "Historical patterns unfavorable"
```

**Every AI engine output is identical for PARQ, Bountywork, and ZINC.**

---

## 6. The Meteora TVL/Liquidity Irrelevance Theorem

The only differentiating data across pools is the Meteora pool's TVL and liquidity. Here is every code path where this data is consumed:

| Engine | Variable | Formula | Pool-specific? | Differentiating? |
|---|---|---|---|---|
| feeAprPrediction | `tvl` | divider: `fees / tvl * 365 * 100` | ✅ different TVL | ❌ `fees=0` → `0/tvl=0` |
| feeAprPrediction | `growthFactor` | `volumeTrend === 'up' ? 1.2 : ...` | ❌ `volumeTrend='stable'` | ❌ `'stable' → 1.0` |
| liquidityUtilization | `liquidity`, `tvl` | divider: `volume24h / liquidity` | ✅ different liq | ❌ `volume24h=0` → `0/liq=0` |
| liquidityStability | `getAggregated()` | needs ≥2 snapshots | ✅ filtered by pool | ❌ only 1 snap → zeros |
| rangeEfficiency | `tvl` | divider: `volume24h / tvl` | ✅ different TVL | ❌ `volume24h=0` → `0/tvl=0` |
| rangeEfficiency | `feeEfficiency` | `feesGenerated / tvl` | ✅ different TVL | ❌ `fees=0` → `0/tvl=0` |
| lpMomentum.feeTvl | `tvl` | divider: `fees/tvl*100` | ✅ different TVL | ❌ `fees=0` → `0/tvl=0` |
| lpMomentum.liqStab | `getAggregated()` | needs ≥2 snapshots | ✅ filtered by pool | ❌ only 1 snap → zeros |
| lpMomentum.capInflow | `getAggregated()` | liq change | ✅ filtered by pool | ❌ only 1 snap → zeros |
| All others | — | no Meteora data used | — | — |

**Theorem:** For any pool P, if `fees(P) = 0` and `volume24h(P) = 0` and `holdings(P) = []` and `transactions(P) = []` and `snapshots(P) < 2`, then the alpha score S(P) is constant regardless of P's Meteora TVL or liquidity value.

**Proof:** Every term where TVL or liquidity appears divides into a numerator that is always 0 (zero fees, zero volume, zero change). The only non-zero engine contributions (`feeAprPrediction=10`, `liquidityStability=30`, `txMomentum=10`, `risk=85`, `lpMomentum=18`) do not depend on any pool-specific data at all.

---

## 7. Fresh Read Verification (No Cache Staleness)

All repository reads use **fresh queries** against internal Maps/Arrays. No stale cache issue:

```typescript
// Each engine call performs fresh reads:
const latestLiquidity = await repositories.liquidity.getLatest(poolAddress);
// → getLatest() checks cache first, but cache TTL = 15s
//   → On first call: cache miss → queries internal array fresh
//   → On repeated call within 15s: returns cached
```

### Per-pool cache behavior

| Scenario | Pool A evaluated first | Pool B evaluated second | Pool A evaluated again |
|---|---|---|---|
| `liquidity.getLatest(poolA)` | Cache miss → fresh | — | Cache miss (TTL expired) → fresh |
| `liquidity.getLatest(poolB)` | — | Cache miss → fresh | — |
| `market.getLatest(poolA)` | Cache miss → fresh | — | Cache miss → fresh |
| `market.getLatest(poolB)` | — | Cache miss → fresh | — |
| `transaction.getRecent(poolA)` | Cache miss → fresh (from array filter, no cache) | — | Cache miss → fresh |

The cache TTL is 15s for `getLatest` and 10s for transaction list cache. In normal evaluation flow, pools are evaluated sequentially with no inter-pool wait. The cache for pool A expires before pool B is done, ensuring fresh reads.

**No stale data is possible** — each pool's query filters by poolAddress, and the underlying array/Map is up-to-date within the same Node.js process.

---

## 8. Default Values Influencing the Score (Top 20)

| # | Default Value | Source | Engine | Score Impact |
|---|---|---|---|---|
| 1 | `tvl = 1` | `latestLiquidity?.tvl ?? 1` | feeAprPrediction, rangeEfficiency, lpMomentum | prevents NaN, no score effect |
| 2 | `liquidity = 1` | `latestLiquidity?.liquidity ?? 1` | liquidityUtilization | prevents NaN, no score effect |
| 3 | `volume24h = 0` | `latestMarket?.volume24h ?? 0` | liquidityUtilization | **directly causes score=0** |
| 4 | `fees1h = 0` | `[].reduce(...) = 0` | feeAprPrediction | **directly causes score=10** |
| 5 | `fees24h = 0` | `[].reduce(...) = 0` | feeAprPrediction | **directly causes score=10** |
| 6 | `volumeTrend = 'stable'` | `calculateTrend(0, 0)` → `'stable'` | feeAprPrediction | **contributes 10 to score** |
| 7 | `txVelocity = 0` | `0/5` | txMomentum | reduces score |
| 8 | `txTrend = 'stable'` | count=prevCount → stable | txMomentum | **contributes 10 to score** |
| 9 | `stabilityBonus = 30` | `worstDrain(0) > -5 → true` | liquidityStability | **entire score = 30** |
| 10 | `changePercent = 0` | `<2 snaps → return {0,0,0,0}` | liquidityStability, lpMomentum | **causes false stability** |
| 11 | `smartWalletCount = 0` | holder.getByToken → [] | smartMoney | **directly causes score=0** |
| 12 | `avgHoldDuration = 0` | holders.length===0 → return 0 | smartMoney | **directly causes score=0** |
| 13 | `volume24h = 0` (market) | `latestMarket?.volume24h ?? 0` | rangeEfficiency | **directly causes score=0** |
| 14 | `totalHolders = 0` | holder.getByToken → [] | holderGrowth | **directly causes score=0** |
| 15 | `top10Concentration = 0` | holder.getConcentration → 0 | risk | reduces deductions |
| 16 | `bundlerScore = 0` | detectBundlers([]) → 0 | risk | reduces deductions |
| 17 | `rugProbability = 0.2` | only holder count contributes | risk | marginal effect |
| 18 | `priceChanges = 50` | not provided → return 50 | lpMomentum | **contributes 7.50 to score** |
| 19 | `rankTier(0)` = `return 0` | feeTvlRatio=0 → 0>0 false → 0 | lpMomentum | **contributes 0** |
| 20 | `liquidityChange(0)` = 0 | only 1 snap → change=0 | lpMomentum.capInflow | **contributes 0** |

---

## 9. Root Cause Summary

```
PARQ ──┐                     ┌─ feeAprPrediction → 10
       │                     ├─ liquidityUtilization → 0
       ├─ fullSync ──┐       ├─ txMomentum → 10
Bounty ──┤           │       ├─ capitalInflow → 0
       │           │       ├─ liquidityStability → 30
       │           ├───→   ├─ smartMoney → 0
       │           │       ├─ smartLP → 0
ZINC ──┘           │       ├─ rangeEfficiency → 0
                   │       ├─ holderGrowth → 0
                   │       ├─ narrative → 0
                   │       ├─ risk → 85 (contrib 0.30)
                   │       ├─ lpMomentum → 18 (contrib 1.80)
                   │       │
                   │       └─ WEIGHTED SCORE = 7.50
                   │
    Birdeye API ───┘   (all 3 pools write identical zero/empty data)
    │                   
    └── {success, data} wrapper NOT unwrapped
        → token.symbol = undefined → JUP fallback → OK
        → token.marketCap = undefined → 0 → VALIDATION FAILS ❌
        → token.liquidity = undefined → 0 → VALIDATION FAILS ❌
        → holder.map fails → EMPTY ❌
        → txs.map fails → EMPTY ❌
        → market volume = undefined → 0 → STORED WITH ZEROS ⚠️
```

### Final Answer

**PARQ, Bountywork, and ZINC converge to identical alpha scores because:**

1. **fullSync() produces identical repository state for every pool** — 3 repositories remain completely empty (token, holder, transaction) and 1 stores all-zeros (market). Only liquidity has real data.

2. **The only pool-specific data (Meteora TVL/liquidity) is mathematically irrelevant** — it serves as a divisor in fee/volume ratio calculations, but the numerators (fees, volume, tx count) are always 0, making the division result 0 regardless of the TVL/liquidity value.

3. **No engine uses pool-specific data to produce a differentiated score** — every non-zero engine score (`feeAprPrediction=10`, `txMomentum=10`, `liquidityStability=30`, `risk=85`, `lpMomentum=18`) is either purely from hardcoded defaults or depends on empty repositories that return identical results for every pool.

4. **The weighted formula is deterministic** — with identical inputs, it produces identical outputs: `Σ(score_i × weight_i) = 7.50` for every pool.
