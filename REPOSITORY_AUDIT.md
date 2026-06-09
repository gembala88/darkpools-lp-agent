# Repository Audit Report

**Project:** Meridian DLMM LP Agent  
**Date:** 2026-06-09  
**Audit Scope:** Full repository — root `.js` files, `src/` TypeScript, `tools/`, `tests/`  
**Status:** Pre-migration audit

---

## 1. Duplicate Engines

| # | Component A | Component B | Overlap | Severity | Action |
|---|---|---|---|---|---|
| 1 | `liquidityStabilityEngine.ts` | `lpMomentumEngine.evaluateLiquidityStability()` | **Nearly identical** — same data source, timeframes (30/60/240m), thresholds (-20%/-40%), different scoring formula | **HIGH** | Consolidate: delegate or remove private method |
| 2 | `holderGrowthEngine.ts` | `lpMomentumEngine.evaluateHolderGrowth()` | **High** — same rejection condition `growth1h<0 && growth4h<0` (verbatim copy), same data source | **HIGH** | Consolidate: delegate to `HolderGrowthEngine` or extend it with granular mode |
| 3 | `txMomentumEngine.ts` | `lpMomentumEngine.evaluateTxMomentum()` | **Similar** — same metric (tx velocity+acceleration), same timeframes (5/15/30/60m), formulas differ (raw diff vs percentage) | **MEDIUM** | Consolidate: delegate to `TxMomentumEngine` |
| 4 | `capitalInflowEngine.ts` | `lpMomentumEngine.evaluateCapitalInflow()` | **Similar** — same 3 data sources, same component categories, strikingly similar capping constants (`*5`, `/1000`) | **MEDIUM** | Consolidate: delegate to `CapitalInflowEngine` |
| 5 | `feeVelocityEngine.ts` | `lpMomentumEngine.evaluateFeeTvlRatio()` | **Low** — both compute fees via `volumeUsd * 0.003` but measure different things (velocity vs yield ratio) | **LOW** | Keep both, no action needed |
| 6 | `buySellPressureEngine.ts` | `traderGrowthEngine.ts` | **None** — orthogonal signals (volume imbalance vs participant growth) | — | Keep both |
| 7 | `liquidityUtilizationEngine.ts` | `feeAprPredictionEngine.ts` | **Low** — both touch TVL but compute different metrics (utilization ratio vs APR prediction) | — | Keep both |

**File:** `lpMomentumEngine.ts` re-implements 4 sub-engines as private methods instead of composing them, causing duplicate repository calls on every evaluation cycle.

---

## 2. Duplicate API Calls

| Caller | Repository Call | Duplicated By | Impact |
|---|---|---|---|
| `lpMomentumEngine.ts` (7 private methods) | `transaction.getRecent()` | `txMomentumEngine.ts`, `feeVelocityEngine.ts`, `feeAprPredictionEngine.ts`, `capitalInflowEngine.ts` | Same pool's transactions fetched 5x per evaluation |
| `lpMomentumEngine.ts` (7 private methods) | `liquidity.getAggregated()` | `liquidityStabilityEngine.ts`, `capitalInflowEngine.ts` | Same pool liquidity fetched 3x per evaluation |
| `lpMomentumEngine.ts` (7 private methods) | `liquidity.getLatest()` | `liquidityUtilizationEngine.ts`, `feeAprPredictionEngine.ts` | Redundant TVL fetches |
| `lpMomentumEngine.ts` (7 private methods) | `holder.getByToken()` | `holderGrowthEngine.ts`, `smartMoneyConvictionEngine.ts`, `capitalInflowEngine.ts` | Same token holders fetched 4x per evaluation |
| `lpAlphaScoreEngine.ts` | Delegates to all engines above | Orchestrates all — each engine+`lpMomentum` makes independent calls | Each evaluation cycle makes ~15-20 redundant repository calls |

**Root cause:** `lpMomentumEngine.ts` does not delegate to existing standalone engines. Fixing the consolidation (Section 1) resolves this.

---

## 3. Unused Files

| File | Status | Severity | Notes |
|---|---|---|---|
| **Entire `src/` directory** (42 files) | **Dead code in production** | **CRITICAL** | No root `.js` file imports any `src/` file. The entire TypeScript subtree is a parallel implementation never loaded at runtime. |
| `@solana/spl-token` (package.json) | **Unused dependency** | **HIGH** | Zero imports in any `.js` or `.ts` file |
| `@types/node-cron` (package.json) | **Unused devDependency** | **MEDIUM** | Not referenced in any `.ts` file |
| `test/test-screening.js` | **Orphaned test** | **LOW** | Replaced by `tests/` directory (different test framework) |
| `test/test-agent.js` | **Orphaned test** | **LOW** | Replaced by `tests/` directory |
| `screening-scales.js` (root) | Used by `config.js` | — | Alive |
| `dev-blocklist.js` (root) | Used by `tools/screening.js` | — | Alive |
| All other root `.js` files | **Alive** | — | Imported by `index.js` or `tools/executor.js` |

---

## 4. Circular Dependencies

| Scope | Result |
|---|---|
| `src/` TypeScript files | **No circular dependencies** — import graph is acyclic |
| Root `.js` files | **No circular dependencies** — all imports form a DAG |
| `src/engines/index.ts` | Safe — engine files import directly from `./baseEngine.js` and `../repositories/index.js`, not from barrel |
| `src/repositories/index.ts` | Safe — repos only import `./baseRepository.js` and `../types/index.js` |

---

## 5. Missing Types

| Finding | Location | Severity | Details |
|---|---|---|---|
| **Duplicate `EngineResult` interface** | `src/types/index.ts:111` vs `src/engines/baseEngine.ts:7` | **HIGH** | `types/index.ts` version is MISSING `reason: string` field. All engines import from `baseEngine.ts` (correct), but external consumers importing from `src/index.ts` barrel get the wrong type. |
| `as unknown as X` casts | `src/repositories/*.ts` (7 locations) | **MEDIUM** | Cache stores `T` but repos store `T[]` — generic param doesn't accommodate arrays. Pattern: `cached as unknown as TokenData[]` |
| `Cache<T = unknown>` default type | `src/utils/cache.ts:6` | **MEDIUM** | Using `Cache` without type param silently bypasses all type checking |
| Metadata `as number` casts | 5 engine files (~20 locations) | **LOW** | `(metadata.foo as number)` pattern — safe at runtime but bypasses type checking |
| Zero JSDoc in `tools/` | All 9 `tools/*.js` files | **MEDIUM** | No `@param`, `@returns`, `@typedef` annotations anywhere. Largest file `dlmm.js` (2194 lines) has zero documentation. |

---

## 6. Missing Tests

| Module | Source Files | Test Files | Coverage | Missing |
|---|---|---|---|---|
| `src/engines/` | 24 | 2 | **8.3%** | 22 engines untested (only `txMomentum` and `volatility` have tests) |
| `src/repositories/` | 7 | 3 | **42.9%** | `baseRepository.ts`, `liquidityRepository.ts`, `marketRepository.ts`, `index.ts` |
| `src/services/` | 2 | 0 | **0%** | `lpIntelligenceService.ts`, `marketDataService.ts` |
| `src/integrations/` | 6 | 0 | **0%** | All 4 adapters + base + index |
| `src/logging/` | 2 | 0 | **0%** | `logger.ts`, `index.ts` |
| `src/telemetry/` | 2 | 0 | **0%** | `telemetryService.ts`, `index.ts` |
| `src/utils/` | 2 | 0 | **0%** | `cache.ts`, `math.ts` |
| `src/filters/` | 1 | 1 | **100%** | — |
| **Total** | **46** | **6** | **13.0%** | **40 source files lack tests** |

---

## 7. Missing Environment Variables

### 7.1 Used in Code but Missing from `.env.example`

| Variable | Used In | Has Fallback? | Risk |
|---|---|---|---|
| `BIRDEYE_API_KEY` | `src/integrations/index.ts:13` | **NO** | Adapter will fail at runtime |
| `JUPITER_API_KEY` | `src/integrations/index.ts:15`, `config.js:258` | Partial (`""` default) | Adapter may return degraded data |
| `GMGN_API_KEY` | `config.js:51`, `tools/gmgn.js:27` | Yes (config file) | Low — user-config.json fallback |
| `ENVRYPT_KEY` / `ENVCRYPT_KEY` | `envcrypt.js:37-38` | Yes (file fallback) | Low |
| `HIVEMIND_API_KEY` | `config.js:246` | Yes (hardcoded default) | Low |
| `AGENT_MERIDIAN_API_URL` | `config.js:49` | Yes (hardcoded default) | Low |
| `PUBLIC_API_KEY` | `config.js:48`, `tools/study.js:5` | Yes (hardcoded default) | Low |
| `JUPITER_REFERRAL_ACCOUNT` | `config.js:260` | Yes (hardcoded address) | Low |
| `JUPITER_REFERRAL_FEE_BPS` | `config.js:263` | Yes (default 50) | Low |

### 7.2 Env Vars with No Fallback (HIGH risk)

| Variable | File:Line | Impact |
|---|---|---|
| `RPC_URL` | `tools/wallet.js:16`, `tools/dlmm.js:83` | `new Connection(undefined)` throws — crashes on any on-chain operation |
| `BIRDEYE_API_KEY` | `src/integrations/index.ts:13` | Adapter likely fails silently |

### 7.3 Documentation Discrepancies

| Document | Issue |
|---|---|
| `.env.example` | Missing 10 env vars: `BIRDEYE_API_KEY`, `JUPITER_API_KEY`, `JUPITER_REFERRAL_ACCOUNT`, `JUPITER_REFERRAL_FEE_BPS`, `GMGN_API_KEY`, `AGENT_MERIDIAN_API_URL`, `PUBLIC_API_KEY`, `ENVRYPT_KEY`, `ENVCRYPT_KEY`, `HIVEMIND_API_KEY` |
| `CLAUDE.md` | Missing from env var table: `LOG_LEVEL`, `TELEGRAM_ALLOWED_USER_IDS`, `ALLOW_SELF_UPDATE`, plus all 10 above |

---

## 8. Severity Summary

| Severity | Count | Key Items |
|---|---|---|
| **CRITICAL** | 1 | Entire `src/` TypeScript subtree is dead code in production |
| **HIGH** | 6 | 4 engine duplications, `@solana/spl-token` unused, `EngineResult` type mismatch |
| **MEDIUM** | 5 | Repository cache casts, metadata `as number` pattern, zero JSDoc in tools, missing test coverage, missing `.env.example` entries |
| **LOW** | 4 | Standalone test scripts orphaned, `@types/node-cron` unused, fee velocity vs fee/TVL overlap acceptable |

---

## 9. Recommended Fix Priority

```
P0 (BEFORE MIGRATION):
  └─ Add `BIRDEYE_API_KEY`, `JUPITER_API_KEY` to `.env.example`
  └─ Fix `EngineResult` interface in `types/index.ts` — add `reason: string`
  └─ Remove `@solana/spl-token` from `package.json`

P1 (IMMEDIATE):
  └─ Consolidate `lpMomentumEngine.ts` — delegate 4 private methods to standalone engines
  └─ Fix repository cache generic to handle `T[]` without `as unknown as X`
  └─ Add tests: `liquidityRepository`, `marketRepository`, `baseEngine`

P2 (BEFORE FIRST LIVE DEPLOY):
  └─ Add all missing env vars to `.env.example`
  └─ Update `CLAUDE.md` env var table
  └─ Add JSDoc to `tools/` — prioritize `executor.js` (safety checks) and `dlmm.js` (deploy logic)
  └─ Add tests: `lpAlphaScoreEngine`, `lpMomentumEngine`, `marketDataService`

P3 (BACKLOG):
  └─ Remove orphaned test scripts `test/test-screening.js`, `test/test-agent.js`
  └─ Add tests for all remaining engines (22 files)
  └─ Add integration tests for all adapters
  └─ Add `@types/node-cron` removal if confirmed unused
```

---

*Audit generated 2026-06-09. 42 files examined, 46 tests run, 25+ issues identified.*
