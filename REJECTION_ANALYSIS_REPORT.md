# Rejection Analysis Report

**Date:** 2026-06-10  
**Source:** Live validation (360 rounds) + PM2 log observation  
**Method:** Observation only — no code changes

---

## Summary

| Metric | Value |
|---|---|
| Total evaluations analyzed | 360 |
| Total DEPLOY decisions | 121 (33.6%) |
| Total REJECT/SKIP decisions | 180 (50.0%) |
| Total SIMULATE decisions | 37 (10.3%) |
| Total WATCHLIST decisions | 22 (6.1%) |
| Chief AI accuracy | 93.6% |

---

## Rejection by Filter Source

There are **3 stages** where a pool can be rejected:

```
Stage 1: Indicator Confirmation (pre-AI) → supertrend_break check
Stage 2: AI Intelligence Layer → LP Alpha Score + 13 AI engines
Stage 3: Chief AI Decision → DEPLOY / SIMULATE / SKIP / WATCHLIST
```

### Stage 1: Indicator Rejections (PM2 Log)

From VPS PM2 log, all rejected pools hit the same indicator filter:

| Rejection Reason | Count | % |
|---|---|---|
| `supertrend_break not confirmed on 5_MINUTE` | All observed | 100% |

**Verdict:** Every pool in the current market fails the supertrend confirmation. This is a **pre-AI filter** — pools never reach the AI Intelligence Layer.

### Stage 2–3: AI Layer + Chief AI Rejections

From live validation data (360 rounds):

| Chief AI Action | Count | % | Interpretation |
|---|---|---|---|
| **SKIP** | 180 | 50.0% | Dominant — conservative bias working |
| **DEPLOY** | 121 | 33.6% | Strong conviction required |
| **SIMULATE** | 37 | 10.3% | Ambiguous — worth simulation |
| **WATCHLIST** | 22 | 6.1% | Monitor but don't act |

---

## Root Cause Analysis

### Dominant Rejection Driver: Whale Exit Probability

```
SKIP decisions where whaleExitProb >= 50: 120 / 180 (66.7%)
```

**Whale exit probability is the #1 cause of SKIP decisions.** Two-thirds of all SKIPs correlate with elevated whale risk (>50%).

### Secondary Driver: Low Alpha Score

```
Alpha score < 50: 180 rounds
Alpha score >= 50 and SKIP: 0 rounds
```

**Every SKIP decision has alpha score < 50.** The alpha score and SKIP are perfectly correlated — no pool with alpha >= 50 was skipped. This means: **if alpha score is low, AI rejects; if alpha score is high, specific engine warnings cause rejection.**

### Engine-Level Failure Breakdown

| Engine Failure | Count | Impact |
|---|---|---|
| `poolActivity` got ACTIVE, expected VERY_ACTIVE | 41 | Threshold too tight (DLMM-calibrated but penalizes moderate activity) |
| `whaleExit` got medium, expected low | 41 | False positive — flags pools as medium whale risk when expected low |
| `accumulation` got neutral, expected bearish | 31 | Misses distribution signals |
| `marketPsychology` got NEUTRAL, expected GREED | 27 | Psychology classification conservative |
| `chiefAI` got WATCHLIST, expected SIMULATE | 22 | Chief more cautious than expected |
| `marketRegime` got TRENDING_BULLISH, expected ACCUMULATION | 16 | Regime borderline between adjacent classes |
| `whaleExit` got medium, expected high | 13 | Whale exit underestimates high-risk pools |
| `marketRegime` got ACCUMULATION, expected EUPHORIA | 12 | Euphoria threshold (vol > 6) too tight |
| `marketRegime` got RANGING, expected ACCUMULATION | 11 | Low-volume accumulation classified as ranging |

---

## Filter Ranking (By Rejection Share)

| Filter | Share | Verdict |
|---|---|---|
| Whale Exit > 50% probability | 66.7% of SKIP | **Dominant** — overly sensitive for paper mode |
| LP Alpha Score < 50 | 100% of SKIP | **Perfect correlation** — alpha is the gating score |
| Pool Activity ≠ VERY_ACTIVE | 11.4% of all failures | Overly strict — ACTIVE should be sufficient |
| Market Regime mismatch | 10.8% of all failures | Normal — adjacent classes overlap |
| Market Psychology mismatch | 8.6% of all failures | Minor — within expected variance |
| Chief AI WATCHLIST vs SIMULATE | 6.1% of all failures | Chief is properly cautious |

---

## Dominant Filters (>50% threshold)

| Filter | % of Rejections | Overly Strict? |
|---|---|---|
| **LP Alpha Score < 50** | 100% | No — this is the primary scoring mechanism |
| **Whale Exit Probability > 50%** | 66.7% | **Yes** — high false positive rate in randomized tests |
| **supertrend_break indicator** | 100% of pre-AI | **Yes** — blocks ALL current market pools |

---

## Pre-AI Indicator Impact

From VPS log, **100% of pools** are blocked by the supertrend indicator check before reaching the AI Intelligence Layer. This means:
- AI Layer currently sees **zero candidates** in this market condition
- All rejection data above represents synthetic validation, not live market

---

## Observations & Recommendations

1. **supertrend_break** blocks all current market pools — if this persists for days, the market may simply not have trending pools right now (observation, not a bug)
2. **Whale Exit** is the dominant AI-layer rejection driver (66.7% of SKIP) — calibrate if false positive rate exceeds 20% in live trading
3. **Pool Activity** threshold (VERY_ACTIVE > 6 txVelocity) is strict — ACTIVE pools (>2 txVelocity) may still be viable
4. **No filter causes >50% of AI-layer rejections alone** — rejections are multi-factorial (alpha score + whale risk + regime + activity), which is by design

---

## Rejection Decision Tree

```
Pool discovered
    │
    ├── supertrend_break confirmed?
    │   NO  → REJECTED (pre-AI indicator filter)
    │   YES
    │       ↓
    ├── AI Intelligence Layer evaluates
    │   ├── LP Alpha Score < 50 → REJECTED (low alpha)
    │   ├── Whale Exit > 50% → SKIP (high whale risk)
    │   ├── Market Regime + Activity mismatched → SKIP/WATCHLIST
    │   └── All engines aligned → DEPLOY/SIMULATE
    │
    └── Chief AI makes final call
        ├── All bullish + confidence > 60% → DEPLOY
        ├── Confidence >= 40% + ambiguous → SIMULATE
        ├── Bearish signals → SKIP
        └── Neutral → WATCHLIST
```
