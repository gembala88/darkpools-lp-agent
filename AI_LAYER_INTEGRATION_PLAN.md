# AI Intelligence Layer — Integration Plan

**Date:** 2026-06-09  
**Specification:** Phases 32–46 (DLLM LP New 3 lanjutan.txt)  
**Type:** Extension (no rewrites, no replacements)

---

## Pre-Implementation Audit Summary

### Current Architecture

```
MarketDataService.fullSync()
  ↓
LpAlphaScoreEngine.evaluate()   [12 weighted sub-engines + 3 additional → 15 total]
  ↓
NoDeployFilterV2.evaluate()     [13 hard rejection gates]
  ↓
PositionSizingEngine.evaluate()
  ↓
DeploymentDecisionEngine.evaluate()  [6-tier decision]
```

### Target Architecture

```
MarketDataService.fullSync()
  ↓
LpAlphaScoreEngine.evaluate()
  ↓
AI Intelligence Layer (NEW — Phases 32–46)
  │  ├─ MarketRegimeEngine
  │  ├─ PoolActivityEngine
  │  ├─ AccumulationDetector
  │  ├─ WhaleExitProbabilityEngine
  │  ├─ SmartMoneyFlowEngine
  │  ├─ AICandleIntelligenceEngine
  │  ├─ MarketPsychologyEngine
  │  ├─ SelfLearningEngine
  │  ├─ DeploymentMemoryEngine
  │  ├─ DynamicWeightEngine
  │  ├─ Multi-Agent System (6 agents)
  │  └─ Chief AI
  │
  ├─ AI Analyst Layer (collates all AI signals)
  ↓
NoDeployFilterV2.evaluate()
  ↓
PositionSizingEngine.evaluate()
  ↓
DeploymentDecisionEngine.evaluate()
```

---

## Integration Point Analysis

### 1. `LPIntelligenceService.evaluatePool()` — Primary Integration Point

**File:** `src/services/lpIntelligenceService.ts` (177 lines)

**Current flow:**
```typescript
async evaluatePool(poolAddress, tokenMint, options?): Promise<MasterLPOutput> {
  1. marketData.fullSync(mint, poolAddress)       // populate repositories
  2. lpAlphaScoreEngine.evaluate(params)          // get alpha score + 12 component scores
  3. noDeployFilter.evaluate(filterCriteria)       // hard gates
  4. sizingEngine.evaluate(positionParams)         // position sizing
  5. decisionEngine.evaluate(decisionParams)       // final decision
  6. telemetry.record(...)
  7. return MasterLPOutput
}
```

**Required change:** Insert AI Layer between step 2 and step 3:

```typescript
async evaluatePool(poolAddress, tokenMint, options?): Promise<MasterLPOutput> {
  1. marketData.fullSync(mint, poolAddress)
  2. lpAlphaScoreEngine.evaluate(params)          // ← unchanged
  3. aiIntelligenceLayer.evaluate({               // ← NEW
       lpAlphaScore,
       componentScores,
       poolAddress,
       tokenMint,
       options
     })
  4. noDeployFilter.evaluate(filterCriteria)      // ← unchanged, now gets AI-enhanced data
  5. sizingEngine.evaluate(positionParams)
  6. decisionEngine.evaluate(decisionParams)
  7. telemetry.record(...)
  8. return MasterLPOutput                        // ← extended with AI fields
}
```

---

## Reusable Components (No Duplication)

| Component | Reuse Strategy | Avoids |
|---|---|---|
| `repositories.transaction.getRecent()` | All new engines read from existing repo | Duplicate API calls to Birdeye |
| `repositories.transaction.getVolumeByType()` | PoolActivityEngine reuses | Recalculating buy/sell volume |
| `repositories.holder.getByToken()` | AccumulationDetector, WhaleExit, SmartMoneyFlow reuse | Duplicate holder fetches |
| `repositories.liquidity.getLatest()` | MarketRegime, AccumulationDetector reuse | Duplicate Meteora calls |
| `repositories.liquidity.getAggregated()` | MarketRegime, WhaleExit reuse | Duplicate liquidity history |
| `repositories.market.getLatest()` | MarketRegime, CandleIntelligence reuse | Duplicate DexScreener calls |
| `repositories.market.getVolumeTrend()` | PoolActivity, CandleIntelligence reuse | Duplicate volume calculations |
| `existing engine scores` (txMomentum, feeVelocity, holderGrowth, etc.) | All AI engines use these as pre-computed inputs | Recalculating momentum/growth metrics |
| `LpAlphaScoreEngine.componentScores` | MarketRegime, WhaleExit, DynamicWeight reuse | Re-running sub-engines |
| `existing cache layers` | All engines benefit from repository caching | Redundant data fetching |
| `existing types/index.ts` | New engine results extend `EngineResult` pattern | New type definitions follow established pattern |
| `BaseEngine` abstract class | All new engines extend it | Consistent interface, `normalizeScore()`, `getSignal()` |

---

## Data Dependency Map (New Engines → Existing Data)

| New Engine | Reads From (Repository) | Reads From (Existing Engine Scores) |
|---|---|---|
| **MarketRegimeEngine** | `transaction`, `holder`, `liquidity`, `market` | `txMomentumScore`, `holderGrowthScore`, `capitalInflowScore` |
| **PoolActivityEngine** | `transaction`, `market` | `feeVelocityScore` |
| **AccumulationDetector** | `holder`, `liquidity`, `transaction` | `holderGrowthScore`, `capitalInflowScore`, `smartMoneyScore` |
| **WhaleExitProbabilityEngine** | `holder`, `liquidity`, `transaction` | `buySellScore`, `smartMoneyScore` |
| **SmartMoneyFlowEngine** | `holder`, `transaction` | `smartMoneyScore` |
| **AICandleIntelligenceEngine** | `market` | — (price data only) |
| **MarketPsychologyEngine** | `transaction`, `holder` | `buySellScore`, `holderGrowthScore` |
| **SelfLearningEngine** | — (historical store) | All component scores + deployment result |
| **DeploymentMemoryEngine** | — (historical store) | All component scores + market regime |
| **DynamicWeightEngine** | — | Market regime + all component scores |

**Key constraint met:** Every new engine reads from **existing repositories** or **existing engine outputs**. Zero new API integrations. Zero new websocket subscriptions.

---

## New Engine Specifications (Phase 32–36 Priority 1)

### P1-1: MarketRegimeEngine (Phase 32)

**File:** `src/engines/marketRegimeEngine.ts`  
**Extends:** `BaseEngine`

| Aspect | Detail |
|---|---|
| **Inputs** | `poolAddress`, `tokenMint` (+ existing engine scores passed via metadata) |
| **Repositories used** | `transaction.getRecent()`, `holder.getByToken()`, `liquidity.getAggregated()` |
| **Reused scores** | `txMomentumScore`, `holderGrowthScore`, `capitalInflowScore` |
| **Classifications** | `ACCUMULATION`, `TRENDING_BULLISH`, `TRENDING_BEARISH`, `RANGING`, `DISTRIBUTION`, `PANIC`, `EUPHORIA` |
| **Key outputs** | `marketRegime` (string), `marketRegimeConfidence` (0–100) |
| **No duplicate API calls** | ✅ Reads from repositories already populated by `fullSync()` |
| **No duplicate calculations** | ✅ Reuses existing engine scores instead of recalculating tx momentum / holder growth |

### P1-2: PoolActivityEngine (Phase 33)

**File:** `src/engines/poolActivityEngine.ts`  
**Extends:** `BaseEngine`

| Aspect | Detail |
|---|---|
| **Inputs** | `poolAddress` |
| **Repositories used** | `transaction.getRecent()`, `transaction.getVolumeByType()`, `market.getLatest()`, `market.getVolumeTrend()` |
| **Reused scores** | `feeVelocityScore` |
| **Classifications** | `DEAD` (auto-reject), `LOW`, `NORMAL`, `ACTIVE`, `VERY_ACTIVE` |
| **Rejection** | `activityScore < 40` → AUTO REJECT |
| **No duplicate API calls** | ✅ Reads from repositories only |

### P1-3: AccumulationDetector (Phase 34)

**File:** `src/engines/accumulationDetector.ts`  
**Extends:** `BaseEngine`

| Aspect | Detail |
|---|---|
| **Inputs** | `poolAddress`, `tokenMint` |
| **Repositories used** | `holder.getByToken()`, `liquidity.getLatest()`, `liquidity.getAggregated()`, `transaction.getRecent()` |
| **Reused scores** | `holderGrowthScore`, `capitalInflowScore`, `smartMoneyScore` |
| **Output** | `accumulationProbability` (0–100) |
| **No duplicate API calls** | ✅ All data already in repositories from `fullSync()` |

### P1-4: WhaleExitProbabilityEngine (Phase 35)

**File:** `src/engines/whaleExitProbabilityEngine.ts`  
**Extends:** `BaseEngine`

| Aspect | Detail |
|---|---|
| **Inputs** | `poolAddress`, `tokenMint` |
| **Repositories used** | `holder.getByToken()`, `liquidity.getAggregated()`, `transaction.getRecent()`, `transaction.getVolumeByType()` |
| **Reused scores** | `buySellScore`, `smartMoneyScore`, `capitalInflowScore` |
| **Key outputs** | `whaleExitProbability` (0–100), signals at >75 (reduce), >90 (exit candidate) |
| **No duplicate API calls** | ✅ |
| **No duplicate calculations** | ✅ Reuses buy/sell ratio and smart money scores |

---

## New Engine Specifications (Phase 36–38 Priority 2)

### P2-1: SmartMoneyFlowEngine (Phase 36)

**File:** `src/engines/smartMoneyFlowEngine.ts`  
**Extends:** `BaseEngine`

**Signals:** wallet accumulation, distribution, rotation, re-entry  
**Reuses:** `smartMoneyScore`, `holder.getByToken()`, `transaction.getRecent()`

### P2-2: AICandleIntelligenceEngine (Phase 37)

**File:** `src/engines/aiCandleIntelligence.ts`  
**Extends:** `BaseEngine`

**Signals:** HH, HL, LH, LL, breakouts, pullbacks, EMA20/50/200, volume confirmation  
**Reuses:** `market.getLatest()` (price/volume history from DexScreener)  
**Note:** Requires price history — market repository must have multiple snapshots

### P2-3: MarketPsychologyEngine (Phase 38)

**File:** `src/engines/marketPsychologyEngine.ts`  
**Extends:** `BaseEngine`

**Signals:** FEAR, NEUTRAL, GREED, EUPHORIA, CAPITULATION  
**Reuses:** `buySellScore`, `holderGrowthScore`, `transaction.getRecent()`, `holder.getByToken()`

---

## New Engine Specifications (Phase 39–41 Priority 3)

### P3-1: SelfLearningEngine (Phase 39)

**File:** `src/engines/selfLearningEngine.ts`  
**Extends:** `BaseEngine`

**Stores:** LP Alpha Score, Momentum Score, Market Regime, Deployment Decision, Result (Profit/Loss/APR/Fees)  
**Creates:** Pattern database in memory  
**Output:** `historicalPatternConfidence` (0–100)  
**Note:** Stateful — accumulates data across evaluations

### P3-2: DeploymentMemoryEngine (Phase 40)

**File:** `src/engines/deploymentMemoryEngine.ts`  
**Extends:** `BaseEngine`

**Tracks:** successful/failed deployments, pool categories, narratives, market regimes  
**Output:** `memoryScore` (0–100)  
**Note:** Stateful — accumulates data across evaluations

### P3-3: DynamicWeightEngine (Phase 41)

**File:** `src/engines/dynamicWeightEngine.ts`  
**Extends:** `BaseEngine`

**Objective:** Adjust score importance by market regime  
**Behavior:** Bull market → momentum weight up; Bear market → risk weight up; Accumulation → smart money weight up  
**Output:** `dynamicWeights` (modified weight map)

---

## New Engine Specifications (Phase 42–46 Priority 4)

### P4-1: AI Analyst Layer (Phase 42)

**File:** `src/engines/aiAnalystLayer.ts`  
**Extends:** `BaseEngine`

**Inputs:** All existing engine scores + all new AI engine outputs  
**Output:** AI Analysis Report, AI Confidence, AI Recommendation

### P4-2: Multi-Agent System (Phase 43)

**Directory:** `src/agents/`

| Agent | Purpose |
|---|---|
| `RiskAgent.ts` | AI risk assessment |
| `MomentumAgent.ts` | AI momentum evaluation |
| `WhaleAgent.ts` | AI whale behavior analysis |
| `MarketAgent.ts` | AI market structure analysis |
| `SmartMoneyAgent.ts` | AI smart money flow analysis |
| `NarrativeAgent.ts` | AI narrative evaluation |

Each agent provides: `score`, `confidence`, `reasoning`

### P4-3: Chief AI Decision System (Phase 44)

**File:** `src/agents/chiefAI.ts`

**Inputs:** All 6 agent opinions  
**Output:** Chief AI Recommendation (advisory only)

### P4-4: AI Safety Rules (Phase 45)

AI CANNOT override:
- Risk Engine
- No Deploy Filter
- LP Alpha Score
- Deployment Decision Engine

AI is **advisory only.**

---

## Files to Create

### Priority 1 (New Engines — 4 files)
| File | Path |
|---|---|
| MarketRegimeEngine | `src/engines/marketRegimeEngine.ts` |
| PoolActivityEngine | `src/engines/poolActivityEngine.ts` |
| AccumulationDetector | `src/engines/accumulationDetector.ts` |
| WhaleExitProbabilityEngine | `src/engines/whaleExitProbabilityEngine.ts` |

### Priority 2 (New Engines — 3 files)
| File | Path |
|---|---|
| SmartMoneyFlowEngine | `src/engines/smartMoneyFlowEngine.ts` |
| AICandleIntelligenceEngine | `src/engines/aiCandleIntelligence.ts` |
| MarketPsychologyEngine | `src/engines/marketPsychologyEngine.ts` |

### Priority 3 (New Engines — 3 files)
| File | Path |
|---|---|
| SelfLearningEngine | `src/engines/selfLearningEngine.ts` |
| DeploymentMemoryEngine | `src/engines/deploymentMemoryEngine.ts` |
| DynamicWeightEngine | `src/engines/dynamicWeightEngine.ts` |

### Priority 4 (AI Layer — 8 files)
| File | Path |
|---|---|
| AI Analyst Layer | `src/engines/aiAnalystLayer.ts` |
| RiskAgent | `src/agents/RiskAgent.ts` |
| MomentumAgent | `src/agents/MomentumAgent.ts` |
| WhaleAgent | `src/agents/WhaleAgent.ts` |
| MarketAgent | `src/agents/MarketAgent.ts` |
| SmartMoneyAgent | `src/agents/SmartMoneyAgent.ts` |
| NarrativeAgent | `src/agents/NarrativeAgent.ts` |
| ChiefAI | `src/agents/chiefAI.ts` |

## Files to Modify

| File | Change | Impact |
|---|---|---|
| `src/services/lpIntelligenceService.ts` | Insert AI Layer after alpha scoring, add AI evaluation step | Medium — add ~20 lines |
| `src/engines/index.ts` | Export 10 new engines + 7 agent files | Low — add exports |
| `src/types/index.ts` | Add new output interfaces (AI analysis types) | Medium — extend types |
| `src/index.ts` | Export new services if needed | Low — barrel export |
| `MasterLPOutput` in service | Add new AI fields | Low — interface extension |

## Files NOT Modified

| File | Reason |
|---|---|
| `src/engines/lpAlphaScoreEngine.ts` | Preserved — weights and scoring unchanged |
| `src/engines/lpMomentumEngine.ts` | Preserved — standalone engine |
| `src/engines/riskEngineV2.ts` | Preserved — AI cannot override |
| `src/engines/deploymentDecisionEngine.ts` | Preserved — final authority |
| `src/filters/noDeployFilterV2.ts` | Preserved — 13 rejection criteria unchanged |
| `src/engines/positionSizingEngine.ts` | Preserved — unchanged |
| `src/repositories/*.ts` | Preserved — reused as-is |
| `src/integrations/*.ts` | Preserved — no new API integrations |
| `src/services/marketDataService.ts` | Preserved — data pipeline unchanged |
| Any `.js` root file | Preserved — production runtime unchanged |

---

## Performance & Memory Impact

| Metric | Current | After AI Layer | Delta |
|---|---|---|---|
| **Engine count** | 22 | 32 (+10) | +45% |
| **Repository calls per eval** | ~35–40 | ~45–55 | +30% (all from cache) |
| **External API calls per eval** | 5–7 | 5–7 | 0 (no new integrations) |
| **Memory (engines)** | ~2MB | ~3MB | +1MB |
| **Memory (repositories)** | ~5MB | ~5MB | 0 |
| **Memory (pattern database)** | 0 | ~1MB (SelfLearning) | +1MB |
| **Memory (deployment memory)** | 0 | ~0.5MB (DeploymentMemory) | +0.5MB |
| **Evaluation time per pool** | ~800ms | ~950ms | +150ms (parallel) |

**All new engines run in parallel** within the AI layer (Promise.allSettled), so wall-clock impact is limited to the slowest engine.

---

## Test Plan

| Phase | New Test File | Tests |
|---|---|---|
| 32 | `tests/engines/marketRegimeEngine.test.ts` | Each regime classification |
| 33 | `tests/engines/poolActivityEngine.test.ts` | DEAD reject, ACTIVE pass |
| 34 | `tests/engines/accumulationDetector.test.ts` | Probability scoring |
| 35 | `tests/engines/whaleExitProbabilityEngine.test.ts` | >75 reduce, >90 exit |
| 36 | `tests/engines/smartMoneyFlowEngine.test.ts` | Flow scoring |
| 37 | `tests/engines/aiCandleIntelligence.test.ts` | Trend state classification |
| 38 | `tests/engines/marketPsychologyEngine.test.ts` | Psychology classification |
| 39 | `tests/engines/selfLearningEngine.test.ts` | Pattern storage/retrieval |
| 40 | `tests/engines/deploymentMemoryEngine.test.ts` | Memory score |
| 41 | `tests/engines/dynamicWeightEngine.test.ts` | Weight adjustment |
| 42 | `tests/engines/aiAnalystLayer.test.ts` | Report generation |
| 43–44 | `tests/agents/*.test.ts` | Agent opinions, Chief AI aggregation |

---

## Execution Order (Implementation Sequence)

```
Step 1:  Extend types/index.ts with new AI interfaces
Step 2:  Create MarketRegimeEngine (P1)
Step 3:  Create PoolActivityEngine (P1)
Step 4:  Create AccumulationDetector (P1)
Step 5:  Create WhaleExitProbabilityEngine (P1)
Step 6:  Create SmartMoneyFlowEngine (P2)
Step 7:  Create AICandleIntelligenceEngine (P2)
Step 8:  Create MarketPsychologyEngine (P2)
Step 9:  Create SelfLearningEngine (P3)
Step 10: Create DeploymentMemoryEngine (P3)
Step 11: Create DynamicWeightEngine (P3)
Step 12: Create AI Analyst Layer (P4)
Step 13: Create Multi-Agent System (P4)
Step 14: Create Chief AI (P4)
Step 15: Modify LPIntelligenceService to integrate AI layer
Step 16: Update exports (engines/index.ts, src/index.ts)
Step 17: Run build + tests
```

---

## AI Safety Guarantee

```
┌────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT PIPELINE                          │
│                                                                │
│ Market Data → LP Alpha Score → AI Layer → Risk → Decision     │
│                                      │          │              │
│                                      │ AI can   │ AI cannot    │
│                                      │ analyze   │ override     │
│                                      │ predict   │ bypass       │
│                                      │ recommend │ deploy       │
└────────────────────────────────────────────────────────────────┘
```

The Deployment Decision Engine remains the **final authority**. AI recommendations are advisory metadata passed alongside the existing pipeline. No AI output can bypass the 13 rejection gates of NoDeployFilterV2 or the 6-tier decision system.

---

## Implementation Ready

This plan is ready for implementation. Upon approval:

1. Execute Steps 1–17 in order
2. Verify TypeScript compilation (`npm run build`)
3. Verify all existing tests pass (`npm test`)
4. Verify AI layer integration via new tests
5. Generate full deliverables report
