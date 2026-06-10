# AI Execution Flow Report

**Date:** 2026-06-10  
**Source:** Code trace — `index.js` + `tools/screening.js`  
**Method:** Static analysis, no code changes

---

## Question

When a pool is rejected by `supertrend_break`, does the AI Intelligence Layer still execute?

## Answer

**No. The AI Intelligence Layer is NOT executed for indicator-rejected pools.**

---

## Exact Execution Order

```
Step  index.js:453   getTopCandidates({ limit: 10 })
                        │
                        ▼
      ┌─────────────────────────────────────────────────┐
      │           screening.js: getTopCandidates()       │
      │                                                 │
      │  1. Fetch pools from Meteora API               │
      │  2. Apply hard filters (launchpad, bots, etc.) │
      │  3. INDICATOR CONFIRMATION (supertrend_break)  │
      │     ├─ Confirmed? → keep in eligible[]          │
      │     └─ Rejected?  → REMOVED from eligible[]    │
      │        screening.js:688 logs:                   │
      │        "Indicator rejected <pool>: <reason>"    │
      │  4. Return { candidates: eligible[] }           │
      └─────────────────────────────────────────────────┘
                        │
                        ▼
Step  index.js:458   candidates = topCandidates.candidates
                        │ (only indicator-passed pools remain)
                        ▼
Step  index.js:484   passing = allCandidates.filter(hardFilters)
                        │
                        ▼
Step  index.js:566   AI INTELLIGENCE LAYER EXECUTION
                        │
                        ├─ MarketRegimeEngine.evaluate()
                        ├─ PoolActivityEngine.evaluate()
                        ├─ AccumulationDetector.evaluate()
                        ├─ WhaleExitProbabilityEngine.evaluate()
                        ├─ SmartMoneyFlowEngine.evaluate()
                        ├─ MarketPsychologyEngine.evaluate()
                        ├─ AICandleIntelligenceEngine.evaluate()
                        ├─ SelfLearningEngine.evaluate()
                        ├─ DeploymentMemoryEngine.evaluate()
                        ├─ DynamicWeightEngine.evaluate()
                        ├─ AIAnalystLayer.evaluate()
                        ├─ MultiAgentSystem.evaluate()
                        └─ ChiefAiDecisionSystem.evaluate()
                        │
                        ▼
Step  index.js:634   agentLoop() — LLM decides DEPLOY/SKIP
```

---

## Per-Engine Verification for Indicator-Rejected Pools

| Engine | Executed? | Score Calculated? | 
|---|---|---|
| MarketRegimeEngine | **NO** | No |
| PoolActivityEngine | **NO** | No |
| AccumulationDetector | **NO** | No |
| WhaleExitProbabilityEngine | **NO** | No |
| SmartMoneyFlowEngine | **NO** | No |
| MarketPsychologyEngine | **NO** | No |
| AICandleIntelligenceEngine | **NO** | No |
| SelfLearningEngine | **NO** | No |
| DeploymentMemoryEngine | **NO** | No |
| DynamicWeightEngine | **NO** | No |
| AIAnalystLayer | **NO** | No |
| MultiAgentSystem | **NO** | No |
| ChiefAiDecisionSystem | **NO** | No |

## Key Findings

1. **Rejection happens BEFORE AI evaluation** — at `screening.js:686-689`, inside `getTopCandidates()`
2. **AI Layer only sees pools that PASSED indicator confirmation** — `screening.js:691` splices confirmed-only pools
3. **No engine scores are calculated for rejected pools** — zero compute cost, zero AI analysis
4. **No Chief AI recommendation exists** for these pools
5. **AI Layer has no awareness** of pools filtered by indicators

---

## Code References

| Location | Line | What Happens |
|---|---|---|
| `tools/screening.js` | 658 | `if (config.indicators.enabled && eligible.length > 0)` — indicator check gate |
| `tools/screening.js` | 686 | `if (!confirmation || confirmation.confirmed) return true` — pass only confirmed |
| `tools/screening.js` | 688 | `log("screening", \`Indicator rejected ${pool.name}...\`)` — rejection logged |
| `tools/screening.js` | 691 | `eligible.splice(0, eligible.length, ...confirmedEligible)` — remove rejected |
| `index.js` | 453 | `getTopCandidates()` — returns pre-filtered list |
| `index.js` | 566 | AI Layer evaluation starts — only for remaining candidates |

---

## Implication

The AI Intelligence Layer is a **second-stage filter**. It only evaluates pools that have already passed the indicator confirmation (supertrend_break). This is by design:

```
Stage 1 (pre-AI):  Indicator confirmation → cheap, fast, blocks obvious non-signals
Stage 2 (AI):      AI Intelligence Layer → expensive, deep, evaluates qualified pools
Stage 3 (LLM):     Agent loop → final decision with AI context
```

If supertrend_break blocks 100% of current market pools (as observed in VPS logs), the AI Layer sees **zero candidates** and never generates any recommendation.
