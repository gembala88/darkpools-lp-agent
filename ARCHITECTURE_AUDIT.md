# Architecture Audit Report

**Date:** 2026-06-10
**Scope:** All files under `src/`

## Summary

| Category | Status | Critical | High | Medium | Low |
|----------|--------|----------|------|--------|-----|
| Duplicate Engines | 2 findings | 0 | 1 | 2 | 2 |
| Duplicate API Requests | 0 findings | 0 | 0 | 0 | 0 |
| Duplicate Calculations | 3 findings | 0 | 1 | 2 | 1 |
| Circular Dependencies | 0 findings | 0 | 0 | 0 | 0 |
| Orphan Files | 0 findings | 0 | 0 | 0 | 0 |
| Dead Exports | 5 findings | 0 | 3 | 1 | 1 |

## 1. Duplicate Engines

### Finding 1-A: `LpMomentumEngine` duplicates 4 dedicated engines
- **Severity:** HIGH
- **Files:** `src/engines/lpMomentumEngine.ts`, `src/engines/txMomentumEngine.ts`, `src/engines/liquidityStabilityEngine.ts`, `src/engines/capitalInflowEngine.ts`, `src/engines/holderGrowthEngine.ts`
- **Detail:** `LpMomentumEngine` reimplements identical data-fetching and scoring logic from four existing engines instead of calling them. This duplicates tx momentum, liquidity stability, capital inflow, and holder growth calculations.
- **Recommendation:** Refactor `LpMomentumEngine` to call the dedicated engines (as `LpAlphaScoreEngine` does) rather than duplicating their logic.

### Finding 1-B: `HotPoolDetector` overlaps 4+ dedicated engines
- **Severity:** MEDIUM
- **Files:** `src/engines/hotPoolDetector.ts`
- **Detail:** Scoring formula (`volumeScore + txScore + traderScore + holderScore + feeScore + consistencyScore`) duplicates metrics already computed by dedicated engines.
- **Recommendation:** Remove `HotPoolDetector` in favor of `LpAlphaScoreEngine` composite.

### Finding 1-C: `BuySellPressureEngine` duplicates repository method
- **Severity:** MEDIUM
- **Files:** `src/engines/buySellPressureEngine.ts`, `src/repositories/marketRepository.ts`
- **Detail:** Both compute buy/sell ratio from the same underlying data (transactions vs market snapshots).
- **Recommendation:** Have `BuySellPressureEngine` use `repositories.market.getBuySellRatio()`.

### Finding 1-D: `SmartMoneyFlowEngine` overlaps `SmartMoneyConvictionEngine`
- **Severity:** LOW
- **Files:** `src/ai/smartMoneyFlowEngine.ts`, `src/engines/smartMoneyConvictionEngine.ts`
- **Detail:** Both analyze smart money but from different data sources (transactions vs holder data). Overlapping concept, different dimensions.

### Finding 1-E: `MarketPsychologyEngine` overlaps `BuySellPressureEngine`
- **Severity:** LOW
- **Files:** `src/ai/marketPsychologyEngine.ts`, `src/engines/buySellPressureEngine.ts`
- **Detail:** Both compute buy/sell ratios from transaction data. Could share computation.

## 2. Duplicate API Requests

**None found.** All data access is through in-memory repositories. API calls are confined to `src/integrations/` and called exclusively by `MarketDataService`.

## 3. Duplicate Calculations

### Finding 3-A: Fee rate `0.003` hardcoded in 5 places
- **Severity:** MEDIUM
- **Files:** `src/engines/feeVelocityEngine.ts:22`, `src/engines/feeAprPredictionEngine.ts:20`, `src/engines/hotPoolDetector.ts:33`, `src/engines/rebalanceEngine.ts:48`, `src/engines/rangeEfficiencyEngine.ts:33`
- **Recommendation:** Extract `FEE_RATE = 0.003` to a shared constant.

### Finding 3-B: `BaseEngine.calculateTrend()` unused by most children
- **Severity:** LOW
- **File:** `src/engines/baseEngine.ts:41-47`

### Finding 3-C: Tx velocity duplicated in `LpMomentumEngine`
- **Severity:** HIGH (tied to 1-A)

### Finding 3-D: Volatility calculation duplicated in AI engine
- **Severity:** LOW
- **Files:** `src/engines/volatilityEngine.ts`, `src/ai/aiCandleIntelligenceEngine.ts`

## 4. Circular Dependencies

**None found.** Import graph is a clean directed acyclic graph.

## 5. Orphan Files

**None found.** Every `.ts` file in `src/` is imported by at least one other file.

## 6. Dead Exports

### Finding 6-A: Four types in `types/index.ts` never imported
- **Severity:** HIGH
- **Types:** `FeeData`, `PoolMetrics`, `EngineResult`, `TrendState`
- **Detail:** `EngineResult` is duplicated from `baseEngine.ts`. Others are defined but never referenced.

### Finding 6-B: All 9 functions in `utils/math.ts` are dead code
- **Severity:** HIGH
- **Functions:** `clamp`, `weightedAverage`, `standardDeviation`, `exponentialMovingAverage`, `percentChange`, `movingAverage`, `calculateVelocity`, `calculateAcceleration`, `normalize`
- **Recommendation:** Remove file or keep only used functions.

### Finding 6-C: `DeploymentDecisionEngine.setThresholds()` never called
- **Severity:** LOW
- **File:** `src/engines/deploymentDecisionEngine.ts:73-75`

### Finding 6-D: NoDeployFilterV2 evaluates unpopulated fields
- **Severity:** MEDIUM
- **File:** `src/filters/noDeployFilterV2.ts`, `src/services/lpIntelligenceService.ts:169-170`
- **Detail:** `bundlerScore` always 0, `liquiditySuspicious` always false, `buySellScore` uses wrong key.

### Finding 6-E: `CapitalRotationEngine` never integrated into pipeline
- **Severity:** LOW

## Recommendations

1. **HIGH:** Remove dead exports from `types/index.ts`
2. **HIGH:** Remove dead `utils/math.ts` functions
3. **MEDIUM:** Extract fee rate constant
4. **MEDIUM:** Fix NoDeployFilterV2 unpopulated fields
5. **LOW:** Remove or integrate orphan engines
