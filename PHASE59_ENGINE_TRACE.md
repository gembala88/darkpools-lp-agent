# Phase 59 — Engine Trace Report

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Method:** Static code trace (fullSync executes with empty repository state per Phase 58 root cause)
**Pool:** WSOL (So11111111111111111111111111111111111111112) — representative

---

## 1. Repository State (Before Sync)

```
TokenRepository:      0 entries
HolderRepository:     0 entries
MarketRepository:     0 entries
TransactionRepository: 0 entries
LiquidityRepository:   0 entries
```

All repositories are in initial empty state.

---

## 2. Market Data Sync (fullSync)

```
fetchAndStoreTokenData   → REJECTED (validation: liquidity=0, marketCap=0)
fetchAndStoreHolders     → REJECTED (TypeError: holders.map is not a function)
fetchAndStoreTransactions → REJECTED (TypeError: txs.map is not a function)
fetchAndStoreMarketData  → FULFILLED (all fields default to 0, validation passes)
syncPoolLiquidity        → FULFILLED (Meteora LM pool API, 1 snapshot stored)
```

**Root cause:** `baseIntegration.apiFetch<T>()` at `src/integrations/baseIntegration.ts:51` returns the raw `{success, data}` wrapper. The Birdeye adapter methods return the full wrapper object typed as the inner type. All field accesses at the root level resolve to `undefined`, causing 3/5 syncs to reject and 1 to store zeros.

---

## 3. Repository State (After Sync)

```
TokenRepository:      0 entries  (Δ+0 — validation rejects defaults)
HolderRepository:     0 entries  (Δ+0 — .map fails on wrapper object)
MarketRepository:     1 entry    (Δ+1 — all fields zero, but validation passes)
TransactionRepository: 0 entries  (Δ+0 — .map fails on wrapper object)
LiquidityRepository:   1 entry    (Δ+1 — Meteora pool snapshot, no validation in add())
```

**Key insight:** Only MarketRepository and LiquidityRepository have data, and even those contain zero-filled or single-snapshot entries insufficient for meaningful analysis.

---

## 4. Alpha Engines (12)

### 4.1 feeAprPrediction

| Property | Value |
|---|---|
| **Weight** | 0.18 |
| **Input Available?** | liquidity=1 snapshot, market=1 entry (all 0s), transactions=0 |
| **`tvl`** | `latestLiquidity?.tvl ?? 1` → Meteora TVL or 1 |
| **`fees1h`** | `txs1h.reduce(...)` → 0 (empty array) |
| **`currentApr24h`** | `tvl > 0 ? fees24h / tvl * 365 * 100 : 0` → 0 |
| **`volumeTrend`** | `latestMarket ?? 'stable'` → 'stable' |
| **`txMomentum`** | `market.getTransactionVelocity()` → 0 |
| **`predictedApr24h`** | `currentApr1h * 1.0 * 1.0` → 0 |
| **baseScore** | `min(0/100 * 50, 50)` → 0 |
| **consistencyScore** | `(fees1h > 0 && fees24h > 0) ? 20 : 0` → 0 |
| **growthScore** | `'stable'` → 10 |
| **momentumBonus** | `min(0 * 5, 10)` → 0 |
| **Output Score** | **10** |
| **Signal** | BEARISH |
| **Reason** | `predictedAPR24h=0.00%, predictedAPR7d=0.00%, volumeTrend=stable` |
| **Contribution** | `10 × 0.18 = 1.8000` |

### 4.2 liquidityUtilization

| Property | Value |
|---|---|
| **Weight** | 0.14 |
| **Input Available?** | liquidity=1 snapshot, market=1 entry (all 0s) |
| **`liquidity`** | `latestLiquidity?.liquidity ?? 1` → Meteora liquidity or 1 |
| **`volume24h`** | `latestMarket?.volume24h ?? 0` → 0 |
| **`volumeToLiquidity`** | `0 / liquidity` → 0 |
| **`volumeToTvl`** | `0 / tvl` → 0 |
| **Early return?** | `volumeToLiquidity < 0.01 && volumeToTvl < 0.01` → **YES** |
| **Output Score** | **0** (REJECTED: Extremely low utilization) |
| **Signal** | BEARISH |
| **Reason** | `vol/liquidity=0.0000, vol/tvl=0.0000` |
| **Contribution** | `0 × 0.14 = 0.0000` |

### 4.3 txMomentum

| Property | Value |
|---|---|
| **Weight** | 0.09 |
| **Input Available?** | transactions=0 |
| **All `txCount`** | `getRecent(pool, minutes)` → [] → **0 for all timeframes** |
| **`txVelocity`** | `0 / 5` → 0 |
| **`txAcceleration`** | `0 - max(0, 0)` → 0 |
| **`txTrend`** | `0 > 0 ? 'up' : 0 < 0 ? 'down' : 'stable'` → 'stable' |
| **Rejected?** | `trend === 'down' && acceleration < 0` → No |
| **baseScore** | `min(0 * 10, 50)` → 0 |
| **accelBonus** | `max(0, min(0 * 5, 30))` → 0 |
| **trendBonus** | `'stable'` → 10 |
| **Output Score** | **10** |
| **Signal** | BEARISH |
| **Reason** | `tx velocity=0.00/s, acceleration=0.00` |
| **Contribution** | `10 × 0.09 = 0.9000` |

### 4.4 capitalInflow

| Property | Value |
|---|---|
| **Weight** | 0.09 |
| **Input Available?** | holders=0, transactions=0, liquidity=1 (single snap) |
| **`getNewWallets`** | `holder.getByToken → [] → filter.length` → **0 for all timeframes** |
| **`getNewVolume`** | `transaction.getRecent → [] → reduce` → **0 for all timeframes** |
| **`getNewLiquidity`** | `liquidity.getAggregated (< 2 snapshots) → {0,0,0,0}` → **0 for all timeframes** |
| **`hasInflow`** | `(0 > 0 || 0 > 0 || 0 > 0)` → false |
| **Output Score** | **0** (REJECTED: No capital inflow detected) |
| **Signal** | BEARISH |
| **Reason** | `newWallets=0, volume=0, liquidity=0` |
| **Contribution** | `0 × 0.09 = 0.0000` |

### 4.5 liquidityStability

| Property | Value |
|---|---|
| **Weight** | 0.09 |
| **Input Available?** | liquidity=1 snapshot |
| **`getAggregated(30)`** | `< 2 snapshots in window → {current:0, previous:0, change:0, changePercent:0}` |
| **`getAggregated(60)`** | Same → `changePercent: 0` |
| **`getAggregated(240)`** | Same → `changePercent: 0` |
| **`worstDrain`** | `Math.min(0, 0, 0)` → 0 |
| **Critical drain?** | `0 < -40` → No (all timeframes) |
| **`totalLiquidity`** | `0 + 0 + 0` → 0 |
| **`stabilityBonus`** | `worstDrain > -5` → 30 |
| **`growthScore`** | `max(0, 0 * 0.5) + 30` → 30 |
| **Output Score** | **30** |
| **Signal** | BEARISH |
| **Reason** | `worst drain=0.0%, totalChange=0.0%` |
| **Contribution** | `30 × 0.09 = 2.7000` |

### 4.6 smartMoney

| Property | Value |
|---|---|
| **Weight** | 0.09 |
| **Input Available?** | holders=0, transactions=0 |
| **`holders`** | `holder.getByToken → []` |
| **`smartHolders`** | `[].filter(...)` → [] |
| **`smartWalletCount`** | 0 |
| **`smartWalletTotalPct`** | 0 |
| **`avgHoldDuration`** | `holders.length === 0 → return 0` |
| **`reEntryFreq`** | `transactions.getSmartMoneyTransactions → [] → length 0` |
| **walletCountScore** | `min(0 * 15, 30)` → 0 |
| **concentrationScore** | `min(0 * 2, 30)` → 0 |
| **holdDurationScore** | `min(0 / (3600*1000), 20)` → 0 |
| **reEntryScore** | `min(0 * 2, 20)` → 0 |
| **Output Score** | **0** |
| **Signal** | BEARISH |
| **Reason** | `smartWallets=0, totalPct=0.0%, avgHold=0.0h` |
| **Contribution** | `0 × 0.09 = 0.0000` |

### 4.7 smartLP

| Property | Value |
|---|---|
| **Weight** | 0.09 |
| **Input Available?** | trackedWallets=[] (internal, never populated) |
| **`activeLPs`** | Not provided (undefined) → `[]` |
| **`matchingWallets`** | `[].filter(...)` → [] |
| **Output Score** | **0** |
| **Signal** | NEUTRAL |
| **Reason** | `No smart LP wallets detected on this pool` |
| **Contribution** | `0 × 0.09 = 0.0000` |

### 4.8 rangeEfficiency

| Property | Value |
|---|---|
| **Weight** | 0.04 |
| **Input Available?** | Missing `activeBin`, `lowerBin`, `upperBin` position data |
| **Early return?** | `!poolAddress || activeBin == null || lowerBin == null || upperBin == null` → **YES** |
| **Output Score** | **0** (Missing position data) |
| **Signal** | NEUTRAL |
| **Reason** | `Missing position data` |
| **Contribution** | `0 × 0.04 = 0.0000` |

### 4.9 holderGrowth

| Property | Value |
|---|---|
| **Weight** | 0.04 |
| **Input Available?** | holders=0 |
| **`holders`** | `holder.getByToken → []` |
| **`recent1h`** | `[].filter(...)` → [] |
| **`totalHolders`** | 0 |
| **`growth1h`** | `0 > 0 ? (0/0)*100 : 0` → 0 |
| **`growthScore`** | `0 * 0.6 + 0 * 0.4` → 0 |
| **`totalBonus`** | `min(0/100, 20)` → 0 |
| **Output Score** | **0** |
| **Signal** | BEARISH |
| **Reason** | `totalHolders=0, new1h=0, new4h=0, growth1h=0.00%` |
| **Contribution** | `0 × 0.04 = 0.0000` |

### 4.10 narrative

| Property | Value |
|---|---|
| **Weight** | 0.03 |
| **Input Available?** | `tokenName`, `tokenSymbol`, `narrative` may be provided |
| **`textToAnalyze`** | Depends on caller. With `tokenSymbol='USDC'` → `'usdc'` |
| **Keyword match?** | `'usdc'` contains no narrative keywords → no matches |
| **Output Score** | **0** (with generic name like WSOL/USDC) |
| **Signal** | NEUTRAL |
| **Reason** | `No token info to analyze narrative` (or minimal) |
| **Contribution** | `0 × 0.03 = 0.0000` |

### 4.11 risk

| Property | Value |
|---|---|
| **Weight** | 0.02 |
| **Input Available?** | holders=0, tokenAgeHours default=0, marketCap default=0 |
| **`holders`** | `holder.getByToken → []` |
| **`top10Concentration`** | `getConcentration` → 0 |
| **`bundlerScore`** | `detectBundlers(top10)` → `top10.length < 3 → return 0` |
| **`tokenAgeHours`** | 0 |
| **`marketCap`** | 0 |
| **riskScore start** | 100 |
| **top10 > 80?** | No (0) |
| **bundler > 0.5?** | No (0) |
| **holders < 100?** | Yes (0) → **−15** |
| **tokenAge < 2?** | Yes (0) → **−20** |
| **marketCap < 100k?** | Yes (0) → **−15** |
| **riskScore after deductions** | `100 − 15 − 20 − 15 = 50` |
| **rugProbability** | `0 + 0 + 0.2(age<2) + 0.2(holders<200)` → 0.4 |
| **rug > 0.7?** | No → **no cap** |
| **rug > 0.4?** | No (0.4 is NOT > 0.4) → **no deduction** |
| **Output Score** | **50** |
| **Signal** | NEUTRAL |
| **Reason** | `risk=Medium, top10=0.0%, bundler=0%, rugProb=40%` |
| **Contribution** | `(100 − 50) × 0.02 = 1.0000` |

### 4.12 lpMomentum

| Property | Value |
|---|---|
| **Weight** | 0.10 |
| **Input Available?** | liquidity=1 snap, transactions=0, holders=0, priceChanges=none |

**Sub-evaluations:**

| Sub-engine | Input | Calculation | Score |
|---|---|---|---|
| `evaluateFeeTvlRatio` | tvl=1, fees1h=0 | `fees1h/tvl*100 = 0` → `0 > 0?` → No → `return 0 > 0?` → No → **10** | **10** |
| `evaluateVolumeAcceleration` | all vol=0 | All growth calculations `0 > 0 ? ... : 0` → avgGrowth=0 | **0** |
| `evaluateTxMomentum` | all counts=0 | velocities=0, accel=0, avgAccel=0 → velScore=0, accelScore=10, trendScore=5 | **15** |
| `evaluatePriceChange` | no priceChanges | `!priceChanges || priceChanges.length < 2` → return 50 | **50** |
| `evaluateLiquidityStability` | aggregated all zeros | drain30m=0, drain1h=0 → `0 < -40`? No → `0 < -20`? No → `0 > 0`? No → `0 > -5`? Yes → **85** | **85** |
| `evaluateCapitalInflow` | vol=0, holders=[], liqChange=0 | all 0 → score=0 | **0** |
| `evaluateHolderGrowth` | holders.length=0 | `holders.length === 0 → return 0` | **0** |

**Raw score:**
| Sub-score | Weight | Contribution |
|---|---|---|
| feeTvlRatio = 10 | × 0.25 | = 2.5000 |
| volumeAccel = 0 | × 0.20 | = 0.0000 |
| txMomentum = 15 | × 0.15 | = 2.2500 |
| priceChange = 50 | × 0.15 | = 7.5000 |
| liqStability = 85 | × 0.10 | = 8.5000 |
| capInflow = 0 | × 0.10 | = 0.0000 |
| holderGrowth = 0 | × 0.05 | = 0.0000 |
| **Total raw** | | **20.7500** |

**Output Score:** **21** (normalize)
| Signal | NEUTRAL |
| **Contribution** | `21 × 0.10 = 2.0750` |

---

## 5. Weighted Alpha Score Calculation

```
Component            Score    Weight    (100-risk)  Contribution
─────────────────────────────────────────────────────────────
feeAprPrediction       10  ×  0.18    —           1.8000
liquidityUtilization    0  ×  0.14    —           0.0000
txMomentum             10  ×  0.09    —           0.9000
capitalInflow           0  ×  0.09    —           0.0000
liquidityStability     30  ×  0.09    —           2.7000
smartMoney              0  ×  0.09    —           0.0000
smartLP                 0  ×  0.09    —           0.0000
rangeEfficiency         0  ×  0.04    —           0.0000
holderGrowth            0  ×  0.04    —           0.0000
narrative               0  ×  0.03    —           0.0000
risk                   50  ×  0.02    (100-50)=50  1.0000
lpMomentum             21  ×  0.10    —           2.0750
─────────────────────────────────────────────────────────────
RAW SCORE                                         8.4750
FINAL (normalize [0,100])                          8.48
CONFIDENCE          (9/12 fulfilled = 75%)
```

---

## 6. AI Engines (9)

### 6.1 marketRegime

| Property | Value |
|---|---|
| **Input Available?** | market=1 entry (all 0s), liquidity=1 snapshot |
| **`price`** | `marketData?.price ?? 0` → 0 |
| **`volume24h`** | `marketData?.volume24h ?? 0` → 0 |
| **`tvl`** | `liquidityData?.tvl ?? 0` → Meteora TVL or 0 |
| **`volumeSpike`** | `volume24h/tvl = 0/tvl` → 0 |
| **`txVelocity`** | `txCount5m/5 = 0/5` → 0 |
| **`buyPressure`** | `recentTotal > 0 ? buys/recentTotal : 0.5` → **0.5** |
| **Score** | Falls to "low activity, no directional bias" → **45** |
| **Regime** | `RANGING` |
| **Signal** | NEUTRAL |

### 6.2 poolActivity

| Property | Value |
|---|---|
| **Input Available?** | market=1 entry (all 0s), transactions=0 |
| **`txVelocity5m`** | `0/5` → 0 |
| **`volumeVelocity`** | `0 > 0 ? 0/5 : 0` → 0 |
| **`recentTxs`** | `transaction.getRecent → []` → 0 |
| **Score** | Falls to no conditions → DEAD → **5** |
| **Activity Level** | `DEAD` |
| **Signal** | BEARISH |

### 6.3 accumulationDetector

| Property | Value |
|---|---|
| **Input Available?** | market=1 entry (all 0s), transactions=0, holders=0 |
| **`txRatio`** | `0 > 0 ? buys/0 : 0.5` → 0.5 |
| **`volRatio`** | `(0+0)>0 ? buyVol/(0+0) : 0.5` → 0.5 |
| **`netSmartMoney`** | `0 − 0` → 0 |
| **`topHolderConcentration`** | `getTopHolders → [] → reduce` → 0 |
| **Score** | Falls to "neutral accumulation signal" → **50** |
| **Signal** | NEUTRAL |

### 6.4 whaleExitProbability

| Property | Value |
|---|---|
| **Input Available?** | market=1 entry, transactions=0, holders=0 |
| **`top5Concentration`** | `getTopHolders(5) → [] → reduce` → 0 |
| **`topHolderSells`** | No holders, no transactions → 0 |
| **`totalSellVolume`** | 0 |
| **`buyVol`** | 0 |
| **`exitProbability`** | `0 + 0 + 0 + 0 + 0 + 0` → **0** |
| **Output Score** | `100 − 0` → **100** |
| **Signal** | BULLISH |
| **Key insight** | Empty repos = no whale indicators = lowest possible exit probability |

### 6.5 smartMoneyFlow

| Property | Value |
|---|---|
| **Input Available?** | transactions=0 |
| **`smTotalTx`** | 0 |
| **`smTxRatio`** | `0 > 0 ? buys/0 : 0.5` → 0.5 |
| **`smVolRatio`** | `0 > 0 ? buyVol/(0+0) : 0.5` → 0.5 |
| **`smartMoneyShare`** | `0 > 0 ? 0/0 : 0` → 0 |
| **Score** | Falls to "neutral smart money flow" → **50** |
| **Signal** | NEUTRAL |

### 6.6 candleIntelligence

| Property | Value |
|---|---|
| **Input Available?** | market=1 entry (all 0s), no priceChanges |
| **`price`** | 0 |
| **`volRatio`** | `(0+0)>0 ? 0/0 : 0.5` → 0.5 |
| **`volumeTrend`** | `calculateTrend(0, 0)` → 'stable' |
| **`priceChanges?`** | Not provided → skip entire price-based logic |
| **Output Score** | **50** (no conditions matched; falls through to default `score=50`) |
| **Pattern** | `NEUTRAL` |
| **Signal** | NEUTRAL |

### 6.7 marketPsychology

| Property | Value |
|---|---|
| **Input Available?** | transactions=0, market=1 entry |
| **`buyVol`** | 0 |
| **`sellVol`** | 0 |
| **`totalVol`** | 0 |
| **`buyRatio`** | `0 > 0 ? 0/0 : 0.5` → 0.5 |
| **`txBuyRatio`** | `0 > 0 ? 0/0 : 0.5` → 0.5 |
| **Score** | Falls to "balanced market psychology" → **50** |
| **Psychology** | `NEUTRAL` |
| **Signal** | NEUTRAL |

### 6.8 selfLearning

| Property | Value |
|---|---|
| **Internal `outcomes`** | `[]` (never populated) |
| **`outcomes.length < 5`?** | Yes (0) |
| **Output Score** | **50** (Insufficient data for learning) |
| **Signal** | NEUTRAL |

### 6.9 deploymentMemory

| Property | Value |
|---|---|
| **Internal `deployHistory`** | `[]` (never populated) |
| **`deployHistory.length < 3`?** | Yes |
| **`currentScore`** | Passed from alpha engine: **8.48** |
| **Output Score** | `currentScore` → **8.48** |
| **Signal** | NEUTRAL |

---

## 7. AI Ensemble

### 7.1 Dynamic Weights (Regime: RANGING)

| Engine | Default Weight | RANGING Override | Normalized |
|---|---|---|---|
| marketRegime | 0.15 | → 0.10 | 0.0909 |
| poolActivity | 0.10 | → 0.20 | 0.1818 |
| accumulation | 0.15 | → 0.20 | 0.1818 |
| whaleExit | 0.10 | — | 0.0909 |
| smartMoneyFlow | 0.15 | — | 0.1364 |
| candleIntelligence | 0.10 | — | 0.0909 |
| marketPsychology | 0.10 | — | 0.0909 |
| selfLearning | 0.05 | — | 0.0455 |
| deploymentMemory | 0.10 | — | 0.0909 |
| **Total** | **1.00** | | **1.0000** |

### 7.2 Analyst Layer

```
Engine              Score    Weight    Contribution
────────────────────────────────────────────────────
marketRegime          45  ×  0.0909  =   4.0909
poolActivity           5  ×  0.1818  =   0.9091
accumulation          50  ×  0.1818  =   9.0909
whaleExit            100  ×  0.0909  =   9.0909
smartMoneyFlow        50  ×  0.1364  =   6.8182
candleIntelligence    50  ×  0.0909  =   4.5455
marketPsychology      50  ×  0.0909  =   4.5455
selfLearning          50  ×  0.0455  =   2.2727
deploymentMemory       8  ×  0.0909  =   0.7727
────────────────────────────────────────────────────
WEIGHTED SCORE                       42.14
```

- **consensusSignal**: bullish=0, bearish=1 (poolActivity=5 → bearish), neutral=8 → **NEUTRAL**
- **confidence**: stdDev=26.6 → `100 − 26.6*3` → clamped to **5** (high dispersion)
- **capitalPreservationMode**: `42.14 < 35` → No

### 7.3 Multi-Agent System

| Agent | Bias | Focus Avg | Adjusted | Confidence |
|---|---|---|---|---|
| RiskSentry | conservative | (100+50)/2=75 | 75×0.85+7.5=**71.3** | ~94 |
| MomentumTracker | aggressive | (45+50+50)/3=48.3 | 48.3×1.15−7.5=**48.1** | ~96 |
| SmartMoneyFollower | balanced | (50+50+45)/3=48.3 | **48.3** | ~96 |
| StabilityAnalyst | conservative | (5+50+100)/3=51.7 | 51.7×0.85+7.5=**51.4** | ~55 (high variance: 5,50,100) |
| OpportunityHunter | aggressive | (50+50+45)/3=48.3 | 48.3×1.15−7.5=**48.1** | ~96 |
| PatternRecognizer | balanced | (50+45+50)/3=48.3 | **48.3** | ~96 |

**Consensus weighted score:** **~52.3**
**agreementRatio:** Depends on agent agreement → moderate
**consensusConfidence:** ~70

### 7.4 Chief AI Decision

```
baseScore = analystScore × 0.5 + agentScore × 0.3 + marketRegimeScore × 0.1 + poolActivityScore × 0.1
          = 42.14 × 0.5 + 52.3 × 0.3 + 45 × 0.1 + 5 × 0.1
          = 21.07 + 15.69 + 4.5 + 0.5
          = 41.76
```

| Check | Condition | Result |
|---|---|---|
| whaleExitScore < 30? | 100 < 30 | No |
| marketRegimeScore < 30? | 45 < 30 | No |
| poolActivityScore < 20? | 5 < 20 | **Yes → −10** |
| deploymentMemoryScore < 35? | 8.48 < 35 | **Yes → −10** |
| selfLearningScore < 35? | 50 < 35 | No |
| avgConservative < 40? | (71.3+51.4)/2 = 61.4 < 40 | No |

```
riskAdjustment = -20
finalScore = 41.76 - 20 = 21.76
combinedConfidence = analystConf(5) × 0.6 + agentConsensusConf(70) × 0.4 = 3 + 28 = 31
```

**Action determination:**

| Condition | Result |
|---|---|
| `warnings.length === 0 && finalScore >= 75 && conf > 60` | No (warnings=2, score=21.8) |
| `warnings.length <= 1 && finalScore >= 60 && conf >= 40` | No (score=21.8) |
| `finalScore >= 45`? | No (21.8 < 45) |
| **Action** | **SKIP** |

---

## 8. Final Ensemble Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    POOL TRACE RESULT                         │
│                     WSOL (So1111111...)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  REPOSITORY STATE                                            │
│    TokenRepository:       0 entries                          │
│    HolderRepository:      0 entries                          │
│    MarketRepository:      1 entry  (all zeros)               │
│    TransactionRepository: 0 entries                          │
│    LiquidityRepository:   1 entry  (Meteora TVN)             │
│                                                              │
│  ALPHA SCORE                                                 │
│    Raw score:         8.48  (0-100 scale)                     │
│    Confidence:       75.0%  (9/12 engines fulfilled)         │
│    Signal:           BEARISH (score < 40)                    │
│                                                              │
│  AI ENSEMBLE                                                 │
│    AI Overall Score:  42.1  (analyst weighted)               │
│    AI Confidence:      5.0  (high engine disagreement)       │
│    Multi-Agent Score: 52.3  (6 agents consensus)             │
│    Chief AI Score:    21.8  (after risk adjustments)         │
│    Chief AI Action:   SKIP  (below min threshold)            │
│    Warnings:          Pool activity too low;                 │
│                       Historical patterns unfavorable        │
│                                                              │
│  DEPLOYMENT                                                  │
│    NoDeployFilter:    REJECT (score 8.48, conf 75)           │
│    Final Decision:    REJECT                                 │
│    Allocation:        0%                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Uniform Score Explanation

Every pool evaluated against empty repositories produces **identical engine outputs** because:

| Engine | Reads from | Empty yields | Identical across pools? |
|---|---|---|---|
| feeAprPrediction | LiquidityRepo, TransactionRepo | 0 txs → 0 fees → 0 APR | **YES** |
| liquidityUtilization | LiquidityRepo, MarketRepo | 0 vol → 0 utilization | **YES** |
| txMomentum | TransactionRepo | 0 txs → 0 velocity | **YES** |
| capitalInflow | HolderRepo, TransactionRepo, LiquidityRepo | 0 everywhere → no inflow | **YES** |
| liquidityStability | LiquidityRepo | 0 change → stable | **YES** |
| smartMoney | HolderRepo, TransactionRepo | 0 holders, 0 smart txs | **YES** |
| smartLP | Internal trackedWallets | 0 matches | **YES** |
| rangeEfficiency | MarketRepo, LiquidityRepo, TransactionRepo | 0 vol, 0 fees | **YES** |
| holderGrowth | HolderRepo | 0 holders → 0 growth | **YES** |
| narrative | params only (tokenName/Symbol) | 0 (no keyword match) | **YES** |
| risk | HolderRepo | 0 holders → moderate risk | **YES** |
| lpMomentum | LiquidityRepo, TransactionRepo, HolderRepo | 0 on 5/7 sub-scores | **YES** |
| All 9 AI engines | MarketRepo, TransactionRepo, HolderRepo | Empty → uniform defaults | **YES** |

The only pool-specific data source is `MeteoraAdapter.getPool()` in `syncPoolLiquidity`, which can return different TVL/liquidity per pool. However:
- Only 1 snapshot exists → `getAggregated()` (≥2 required) returns zeros
- `getLatest()` returns the snapshot, but TVL is only used as a divisor in fee calculations — with 0 fees, the TVL value is irrelevant

**Result: All pools score ~8.48 on the alpha engine, leading to identical ensemble outputs.**

---

## 10. Root Cause Confirmation

This trace **confirms** the Phase 58 root cause:

1. **Birdeye wrapper not unwrapped** (`baseIntegration.ts:51`) → 4/5 syncs fail
2. **Validation rejects defaults** (`tokenRepository.ts:39-40`) → token never stored
3. **allSettled swallows errors** → `fullSync` succeeds silently with empty repos
4. **All engines read empty repos** → identical default scores
5. **Score ~8.48 uniform across pools** → matches observation

After applying Fix 1 (unwrap `{success, data}`) and Fix 2 (relax validation), the trace would show:
- Token data with real symbol, price, marketCap, liquidity
- Holders with real addresses, balances, percentages
- Transactions with real signatures, volumes, types
- Market data with real volumes, tx counts, trader counts
- Pool-specific engine scores ranging from ~30-90
- Variance > 1 across pools confirmed
