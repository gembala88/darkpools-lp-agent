# VPS Deployment Report — v1.1.0-rc1

**Date:** 2026-06-10  
**VPS:** Ubuntu 22.04, Node.js 22.22.2  
**Repository:** `gembala88/darkpools-lp-agent`  

---

## Deployment Status

| Check | Status |
|---|---|
| Branch | `release/v1.1.0-rc1` ✅ |
| Commit | `e25b032` ✅ |
| PM2 status | `online` (1 instance) ✅ |
| PM2 restarts | 0 (clean start) ✅ |
| Memory usage | ~22 MB ✅ |
| Startup mode | `DRY RUN` ✅ |
| Real deployment | `ENABLE_REAL_DEPLOYMENT=false` ✅ |
| Model | DeepSeek-V4-Flash ✅ |
| AI Intelligence Layer | ✅ Active |
| Cron cycles | Management 10m, Screening 30m ✅ |
| Telegram bot | Polling started ✅ |

---

## AI Intelligence Layer Verification

| Engine | Status |
|---|---|
| Pool evaluation called | ✅ `[LPIntelligence] Evaluating pool 7EXyMv5...` |
| Evaluation complete | ✅ `score=7.55, decision=REJECT, time=4285ms` |
| Agent loop | ✅ `[AGENT] Step 1/20` |
| No startup errors | ✅ Clean boot |

---

## Safety Gates

| Gate | Value |
|---|---|
| `DRY_RUN` | `true` ✅ |
| `ENABLE_REAL_DEPLOYMENT` | `false` ✅ |
| Wallet balance check | Skipped (DRY RUN) ✅ |
| Max positions | 3 ✅ |

---

## Summary

**VPS deployment successful.** AI Intelligence Layer is actively evaluating pools in every screening cycle. System is in paper trading mode. Real deployment is blocked.
