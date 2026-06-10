# Phase 60 — Repository Identity Audit

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Method:** Static import graph trace + module resolution analysis (DRY_RUN, observation only)

---

## 1. Singleton Creation Site

**File:** `src/repositories/index.ts:14-20`

```typescript
export const repositories = {
  token: new TokenRepository(),       // ← map: tokens = Map<string, TokenData>
  holder: new HolderRepository(),     // ← map: holders = Map<string, HolderData>
  liquidity: new LiquidityRepository(), // ← array: snapshots = LiquiditySnapshot[]
  market: new MarketRepository(),     // ← array: snapshots = MarketData[]
  transaction: new TransactionRepository(), // ← array: transactions = TransactionData[]
} as const;
```

| Repository | Storage Type | Instance Created | Constructor |
|---|---|---|---|
| `TokenRepository` | `Map<string, TokenData>` | Exactly **1** call | `src/repositories/tokenRepository.ts` |
| `HolderRepository` | `Map<string, HolderData>` | Exactly **1** call | `src/repositories/holderRepository.ts` |
| `LiquidityRepository` | `LiquiditySnapshot[]` | Exactly **1** call | `src/repositories/liquidityRepository.ts` |
| `MarketRepository` | `MarketData[]` | Exactly **1** call | `src/repositories/marketRepository.ts` |
| `TransactionRepository` | `TransactionData[]` | Exactly **1** call | `src/repositories/transactionRepository.ts` |

**Confirmed:** The 5 `new XxxRepository()` calls appear only once in the entire codebase. A grep for `new TokenRepository|new HolderRepository|new MarketRepository|new LiquidityRepository|new TransactionRepository` returns **only** `src/repositories/index.ts:15-19`. No duplicates exist in `src/` or `scripts/`.

No DI container, factory, injector, or service provider pattern exists anywhere in `src/`.

---

## 2. Module Import Graph (src/ module tree)

### All 24 src files that import `repositories`

```
SOURCE FILE                                 IMPORT PATH              RESOLVES TO
────────────────────────────────────────────────────────────────────────────────
src/index.ts                               ./repositories/index.js   src/repositories/index.ts
src/services/marketDataService.ts          ../repositories/index.js  src/repositories/index.ts
src/engines/feeAprPredictionEngine.ts      ../repositories/index.js  src/repositories/index.ts
src/engines/liquidityUtilizationEngine.ts  ../repositories/index.js  src/repositories/index.ts
src/engines/txMomentumEngine.ts            ../repositories/index.js  src/repositories/index.ts
src/engines/capitalInflowEngine.ts         ../repositories/index.js  src/repositories/index.ts
src/engines/liquidityStabilityEngine.ts    ../repositories/index.js  src/repositories/index.ts
src/engines/smartMoneyConvictionEngine.ts  ../repositories/index.js  src/repositories/index.ts
src/engines/smartLPEngine.ts               (none — no repo reads)
src/engines/rangeEfficiencyEngine.ts       ../repositories/index.js  src/repositories/index.ts
src/engines/holderGrowthEngine.ts          ../repositories/index.js  src/repositories/index.ts
src/engines/narrativeEngineV2.ts           (none — no repo reads)
src/engines/riskEngineV2.ts                ../repositories/index.js  src/repositories/index.ts
src/engines/lpMomentumEngine.ts            ../repositories/index.js  src/repositories/index.ts
src/engines/buySellPressureEngine.ts       ../repositories/index.js  src/repositories/index.ts
src/engines/traderGrowthEngine.ts          ../repositories/index.js  src/repositories/index.ts
src/engines/feeVelocityEngine.ts           ../repositories/index.js  src/repositories/index.ts
src/engines/hotPoolDetector.ts             ../repositories/index.js  src/repositories/index.ts
src/engines/rebalanceEngine.ts             ../repositories/index.js  src/repositories/index.ts
src/ai/marketRegimeEngine.ts               ../repositories/index.js  src/repositories/index.ts
src/ai/poolActivityEngine.ts               ../repositories/index.js  src/repositories/index.ts
src/ai/accumulationDetector.ts             ../repositories/index.js  src/repositories/index.ts
src/ai/whaleExitProbabilityEngine.ts       ../repositories/index.js  src/repositories/index.ts
src/ai/smartMoneyFlowEngine.ts             ../repositories/index.js  src/repositories/index.ts
src/ai/aiCandleIntelligenceEngine.ts       ../repositories/index.js  src/repositories/index.ts
src/ai/marketPsychologyEngine.ts           ../repositories/index.js  src/repositories/index.ts
src/ai/selfLearningEngine.ts               (none — no repo reads)
src/ai/deploymentMemoryEngine.ts           (none — no repo reads)
```

**All 24 imports** resolve to `../repositories/index.js` (relative to the consumer's directory). When resolved by `tsx`, **all** map to the same module:

```
C:\darkpools-lp-agent\repo\src\repositories\index.ts
```

Node.js module cache stores this module under a single key. Every `import { repositories }` across all `src/` files receives the **identical** `repositories` object reference.

### Identity matrix within src/

```
                    save() path                 read() path               Same instance?
┌────────────────────────────────────────────────────────────────────────────────────┐
│ LPIntelligenceService                                                              │
│   └─ MarketDataService                ──  import repositories                      │
│       ├─ fetchAndStoreTokenData()          repositories.token.upsert()             │
│       ├─ fetchAndStoreHolders()           repositories.holder.bulkUpsert()         │
│       ├─ fetchAndStoreTransactions()      repositories.transaction.bulkAdd()       │
│       ├─ fetchAndStoreMarketData()        repositories.market.add()                │
│       └─ syncPoolLiquidity()              repositories.liquidity.add()             │
│                                                                                    │
│   └─ LpAlphaScoreEngine                                                           │
│       └─ 12 sub-engines                  ──  import repositories                   │
│           ├─ feeAprPrediction:              repos.liquidity.getLatest()            │  ✅ SAME
│           ├─ liquidityUtilization:          repos.liquidity.getLatest()            │  ✅ SAME
│           ├─ txMomentum:                    repos.transaction.getRecent()          │  ✅ SAME
│           ├─ capitalInflow:                 repos.holder.getByToken()              │  ✅ SAME
│           ├─ ... (all engines)              repositories.xxx.yyy()                 │  ✅ SAME
│                                                                                    │
│   └─ aiEngines (9 engines)              ──  import repositories                   │
│       ├─ marketRegime:                     repos.market.getLatest()                │  ✅ SAME
│       ├─ poolActivity:                     repos.market.getLatest()                │  ✅ SAME
│       ├─ ... (all AI engines)              repositories.xxx.yyy()                  │  ✅ SAME
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Conclusion:** Within the `src/` module tree, `save()` (MarketDataService) and `read()` (sub-engines, AI engines) operate on the **identical** `repositories` singleton. No mismatch exists.

---

## 3. The src/ vs dist/ Split

### The problem

The compiled `dist/` directory contains **separate** JavaScript files compiled from TypeScript. Node.js treats `dist/repositories/index.js` and `src/repositories/index.ts` as **different modules** with **different cache keys**.

```
Module Cache Key A: C:\darkpools-lp-agent\repo\src\repositories\index.ts
    → singleton instance A (used by all src/ imports)

Module Cache Key B: C:\darkpools-lp-agent\repo\dist\repositories\index.js
    → singleton instance B (used by all dist/ imports)
```

### Cross-contamination risk

When a script imports from BOTH modules trees, two separate repositories singletons exist:

```
script.ts
  ├── import { X } from '../src/repositories/index.js'   → singleton A
  └── import { Y } from '../dist/services/foo.js'        → dist/foo.js imports
                                                           dist/repositories/index.js
                                                           → singleton B
```

### Affected scripts

| Script | Import from `src/` | Import from `dist/` | Risk |
|---|---|---|---|
| `scripts/shadow_deployment.ts` | ❌ No | ✅ `../dist/services/lpIntelligenceService.js` | ⚠️ `dist/lpIntelligenceService` loads `dist/repositories/index.js` as singleton B, but nobody else in that script uses repositories directly |
| `scripts/phase59_trace.ts` | ✅ `../src/repositories/index.js` + `../src/services/...` | ❌ No | ✅ No mismatch — all src imports |
| `scripts/live_paper_validation.ts` | ✅ `../src/repositories/index.js` + all AI engines from `../src/ai/` | ❌ No | ✅ No mismatch — all src imports |
| `scripts/paper_trading_sim.ts` | ✅ `../src/repositories/index.js` + all from `../src/` | ❌ No | ✅ No mismatch — all src imports |

### Detailed trace: shadow_deployment.ts

```
shadow_deployment.ts (run with: npx tsx scripts/shadow_deployment.ts)
  │
  ├── import { LPIntelligenceService }
  │     from '../dist/services/lpIntelligenceService.js'
  │     │
  │     │   Node.js loads:
  │     │   C:\...\dist\services\lpIntelligenceService.js
  │     │   └─ import { MarketDataService }
  │     │        from './marketDataService.js'
  │     │        └─ import { repositories }
  │     │             from '../repositories/index.js'
  │     │             → C:\...\dist\repositories\index.js
  │     │             → MODULE CACHE KEY B
  │     │             → creates Singleton B
  │     │
  │     │   └─ import { LpAlphaScoreEngine }
  │     │        from '../engines/lpAlphaScoreEngine.js'
  │     │        └─ imports sub-engines
  │     │           └─ import { repositories }
  │     │                from '../repositories/index.js'
  │     │                → C:\...\dist\repositories\index.js
  │     │                → MODULE CACHE KEY B (cache hit)
  │     │                → Singleton B (same)
  │     │
  │     │   └─ import { aiEngines }
  │     │        from '../ai/index.js'
  │     │        └─ AI engines import repositories
  │     │           → MODULE CACHE KEY B (cache hit)
  │     │           → Singleton B (same)
  │     │
  │     └── LPIntelligenceService.evaluatePool()
  │           ├── marketData.fullSync()        writes to Singleton B ✅
  │           ├── alphaEngine.evaluate()       reads from Singleton B ✅
  │           └── aiEngines.*.evaluate()       reads from Singleton B ✅
  │
  └── (no direct repositories import in shadow_deployment.ts)
      → No conflict within this script
```

**Within `shadow_deployment.ts`, the chain is internally consistent** — all writes and reads go through Singleton B because the entire call chain stays within the `dist/` module tree.

---

## 4. save() → read() Identity Chain

### NPX TSX execution (all from src/)

```
MarketDataService.fullSync()               repositories.token.upsert()      ─┐
   (imports src/repositories/index.ts)      repositories.holder.bulkUpsert()  │ Singleton A
                                            repositories.transaction.bulkAdd() │ (writes)
                                            repositories.market.add()         ─┘
                                                    │
                                                    ▼
LpAlphaScoreEngine.evaluate()               repositories.xxx.getYYY()        ─┐
   (each sub-engine imports                    repositories.xxx.getZZZ()      │ Singleton A
    src/repositories/index.ts)                ...                              │ (reads from same)
                                                                              ─┘
                                                    │
                                                    ▼
AI engines.evaluate()                       repositories.xxx.getYYY()        ─┐
   (each AI engine imports                     repositories.xxx.getZZZ()      │ Singleton A
    src/repositories/index.ts)                ...                              │ (reads from same)
                                                                              ─┘
```

**Identity:** `Singleton A === Singleton A` ✅
**Proof:** Node.js module cache key `src/repositories/index.ts` is loaded once. All importers get the same `repositories` object reference. `Map`/`Array` mutations from `save()` are immediately visible to `read()`.

### Dist execution (node dist/index.js — production)

```
Same graph as above, but all paths resolve to dist/repositories/index.js
→ Singleton B throughout. Internally consistent.
```

### Mixed execution (tsx script that imports both src and dist)

**DANGER ZONE:**
```
Script imports:
  - ../src/repositories/index.js     → Singleton A
  - ../dist/services/foo.js          → loads dist/repositories/index.js → Singleton B
  
  write() to A ≠ read() from B  ❌ DATA LOST
  write() to B ≠ read() from A  ❌ DATA LOST
```

---

## 5. Repository Reinitialization Risk

### clear() methods exist

Two repositories expose a public `clear()` method that resets internal state:

| Repository | Method | What it does |
|---|---|---|
| `LiquidityRepository` | `clear()` | `this.snapshots = []; this.cache.clear();` |
| `TransactionRepository` | `clear()` | `this.transactions = []; this.seenSignatures.clear(); this.cache.clear();` |

If any code calls `.clear()` between `fullSync()` and engine evaluation, the data is lost. **No caller of `.clear()` was found in `src/` or `scripts/`.**

### Maximum capacity truncation

| Repository | Max Size | Trim behavior |
|---|---|---|
| `LiquidityRepository` | 10,000 | `slice(-maxSnapshots)` → oldest dropped |
| `MarketRepository` | 5,000 | `slice(-maxSnapshots)` → oldest dropped |
| `TransactionRepository` | 50,000 | `shift()` → oldest signature removed from `seenSignatures` |

With a single snapshot per pool per sync, truncation requires 5,000–50,000 syncs before data loss.

---

## 6. No DI / IoC Container

Confirmed absence of:
- Dependency injection framework
- Inversion of control container
- Service provider pattern
- Factory pattern for repositories
- Module replacement / mocking layer

All 24 repository consumers use direct `import { repositories } from '../repositories/index.js'` — a plain ES module singleton pattern with zero abstraction.

---

## 7. Audit Verdict

### Check results

| Requirement | Result | Evidence |
|---|---|---|
| `save()` repository === `read()` repository | ✅ **CONFIRMED** (within src/ or dist/ module tree) | All 24 src/ imports resolve to same `src/repositories/index.ts`. Same for dist/. |
| Singleton mismatch | ❌ **NOT DETECTED** in normal execution | `npx tsx` from src/ → all src imports. `node dist/` → all dist imports. |
| Duplicate repository instances | ❌ **NOT DETECTED** | Only 5 `new XxxRepository()` calls, all in `src/repositories/index.ts` |
| DI container mismatch | ❌ **NOT DETECTED** | No DI container exists |
| src/ vs dist/ import mismatch | ⚠️ **DETECTED** in `scripts/shadow_deployment.ts` | Imports `LPIntelligenceService` from `../dist/services/` while other scripts import from `../src/` |
| Repository reinitialization | ❌ **NOT DETECTED** | `clear()` methods exist but are never called |

### Cross-script contamination risk matrix

| If run separately | Singleton used | Data isolation | Safe? |
|---|---|---|---|
| `npx tsx src/index.ts` | A (src) | Isolated | ✅ |
| `node dist/index.js` | B (dist) | Isolated | ✅ |
| `npx tsx scripts/phase59_trace.ts` | A (src) | Isolated (all src imports) | ✅ |
| `npx tsx scripts/live_paper_validation.ts` | A (src) | Isolated (all src imports) | ✅ |
| `npx tsx scripts/paper_trading_sim.ts` | A (src) | Isolated (all src imports) | ✅ |
| `npx tsx scripts/shadow_deployment.ts` | B (dist) | Isolated (LPIntelligenceService from dist/) | ✅ |

### When contamination WOULD occur

If any script were to import from **both** `src/repositories/index.js` and `dist/services/lpIntelligenceService.js`:

```typescript
// Hypothetical contaminated script
import { repositories } from '../src/repositories/index.js';       // Singleton A
import { LPIntelligenceService } from '../dist/services/...';     // uses Singleton B

const mds = new MarketDataService();  // writes to Singleton B (via dist/)
await mds.fullSync(mint, pool);

const token = await repositories.token.getByMint(mint);  // reads from Singleton A
// result: NULL — written to B, read from A → DATA LOST ❌
```

This pattern does NOT exist in any current script.

---

## 8. Conclusion

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                        REPOSITORY IDENTITY VERDICT                             │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  Within src/ module tree:     ✅ save() === read() — same singleton            │
│  Within dist/ module tree:    ✅ save() === read() — same singleton            │
│  Across src/ and dist/:       ❌ save() ≠ read() — DIFFERENT singletons       │
│                                                                                │
│  Current scripts (src-only):  ✅ No cross-contamination                        │
│  shadow_deployment.ts:        ⚠️ Uses dist/ singleton — isolated, no conflict  │
│  Repository reinitialization: ✅ No clear() calls found                        │
│  Hardcoded defaults:          ✅ No false 7.5/8.0 constants (emergent result)  │
│                                                                                │
│  SINGLETON INTEGRITY: PASS                                                     │
│  No live data loss due to identity mismatch is occurring.                      │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```
