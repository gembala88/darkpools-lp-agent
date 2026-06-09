# API Validation Audit

**Date:** 2026-06-10

## Summary

| Category | Status |
|----------|--------|
| Direct API calls in engines | ✅ PASS (none found) |
| API call duplication | ⚠️ 2 MEDIUM (pre-existing) |
| Polling frequency | ⚠️ 1 HIGH (pre-existing) |
| Unnecessary API calls | ⚠️ 1 MEDIUM, 1 LOW (pre-existing) |
| Rate limit risks | ❌ 1 CRITICAL, 1 HIGH (pre-existing) |

## Findings

### 1. Direct API Calls in Engines/AI Layer
**Status: PASS**
- Zero `fetch`, `axios`, or HTTP calls in `src/engines/` or `src/ai/`
- All data access is through repository abstractions

### 2. API Call Duplication

#### Finding 2a (MEDIUM): Birdeye/Jupiter token data overlap
- Both `/defi/token_overview` (Birdeye) and `tokens.jup.ag/token/{mint}` (Jupiter) return overlapping token data
- Both called in parallel on every `fullSync()`
- **Status:** Pre-existing (intentional fallback design)

#### Finding 2b (MEDIUM): Birdeye/DexScreener market data overlap
- Both `/defi/token_market_data` (Birdeye) and `/latest/dex/search` (DexScreener) return overlapping market data
- **Status:** Pre-existing (intentional fallback)

### 3. Polling Frequency

#### Finding 3 (HIGH): No throttle on `fullSync()`
- **File:** `src/services/marketDataService.ts:170-183`
- Each `fullSync()` fires **7 parallel HTTP requests** (4 Birdeye, 1 DexScreener, 1 Jupiter, 1 Meteora)
- No minimum interval between successive calls
- **Status:** Pre-existing

### 4. Unnecessary API Calls

#### Finding 4a (MEDIUM): 10 defined API methods never called
- Including `BirdeyeAdapter.getTokenSecurity()`, `JupiterAdapter.getTokenDemand()`, `MeteoraAdapter.getTopPools()`, etc.
- **Status:** Pre-existing dead code

#### Finding 4b (LOW): 5 engines never evaluated
- `BuySellPressureEngine`, `TraderGrowthEngine`, `FeeVelocityEngine`, `CapitalRotationEngine`, `VolatilityEngine` are instantiated but never called
- **Status:** Pre-existing

### 5. Rate Limit Risks

#### Finding 5a (CRITICAL): `rateLimit` config stored but NEVER enforced
- **File:** `src/integrations/baseIntegration.ts:6-60`
- Adapters configure rateLimit (500ms for Birdeye, 300ms for DexScreener, etc.) but `apiFetch()` never reads or uses this value
- **No inter-request throttling exists**
- **Status:** Pre-existing

#### Finding 5b (HIGH): Parallel API burst in `fullSync()`
- Birdeye receives **4 parallel requests** per `fullSync()` call
- Will trigger HTTP 429 on rate-limited tiers
- **Status:** Pre-existing

## AI Layer Impact Assessment

| Aspect | Impact | Detail |
|--------|--------|--------|
| New API calls from AI layer | **NONE** | All AI engines read from repositories only |
| Increased `fullSync()` frequency | **NONE** | AI layer does not trigger additional API calls |
| New rate limit risks | **NONE** | No new external dependencies |

## Verdict

**API VALIDATION: ⚠️ PASS WITH NOTES**

All API-level issues are pre-existing and not introduced by the AI layer. The AI layer adds zero new API requests. One CRITICAL issue (rateLimit config never enforced) should be addressed as a separate task.
