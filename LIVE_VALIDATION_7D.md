# Live Paper Validation — 7-Day Tracking

**Started:** 2026-06-09  
**Status:** Initialized — awaiting 7 days of continuous validation data

---

## Day-by-Day Log

| Day | Date | Evaluations | Accuracy | Notes |
|---|---|---|---|---|
| 1 | 2026-06-09 | 360 | 61.9% | Initial calibration complete, engine fixes applied |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |

---

## Stability Metrics (to track)

- **Accuracy variance:** How much does per-engine accuracy fluctuate day-to-day?
- **Confidence drift:** Does analyst/chief confidence shift over repeated runs?
- **Action bias shift:** Does the DEPLOY/SKIP ratio remain stable?
- **Memory leaks:** Any heap growth across repeated validation runs?
- **Edge case emergence:** Do any archetypes regress as parameters shift?

---

## Revalidation Schedule

- Run the full 360-round validation batch daily
- Track day-over-day accuracy changes for each engine
- If any engine drops below 75%: flag for investigation
- After 7 days: final readiness assessment

---

## Current Engine Baselines (Day 1)

| Engine | Accuracy | Pass/Fail |
|---|---|---|
| Smart Money Flow | 100.0% | ✅ |
| Chief AI | 93.6% | ✅ |
| Market Psychology | 91.4% | ✅ |
| Accumulation | 91.4% | ✅ |
| Market Regime | 89.2% | ✅ |
| Pool Activity | 88.6% | ✅ |
| Whale Exit | 84.7% | ✅ |
| **Overall** | **61.9%** | — |

---

## How to Revalidate

```bash
npx tsx scripts/live_paper_validation.ts
```

Results append to `scripts/live_validation_log.json` and `scripts/live_validation_metrics.json`. Update the day log above after each run.
