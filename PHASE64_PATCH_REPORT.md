# Phase 64 — Patch Report

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Status:** Applied (DRY_RUN — no merge, no deploy)

---

## Files Changed

| File | Change Type |
|---|---|
| `src/integrations/birdeye/birdeyeAdapter.ts` | Modified |
| `src/repositories/tokenRepository.ts` | Modified |
| `tests/repositories/tokenRepository.test.ts` | Modified |

---

## Diff Summary

### Fix 1 — Birdeye response unwrap (`birdeyeAdapter.ts`)

**Problem:** `baseIntegration.apiFetch<T>()` at line 51 returns `response.json() as T` without unwrapping Birdeye's `{success, data}` wrapper. So `getTokenOverview()` returns the wrapper object typed as `BirdeyeTokenOverview`, causing every field read (`birdeyeData?.symbol`, `birdeyeData?.liquidity`, etc.) to return `undefined`.

**Fix:** Added Birdeye-specific `apiFetch` override that detects the `{success, data}` pattern and unwraps to `.data`:

```diff
+  protected async apiFetch<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
+    const raw = await super.apiFetch<Record<string, unknown>>(endpoint, params);
+    if (raw && typeof raw === 'object' && 'success' in raw && 'data' in raw) {
+      return (raw as { data: T }).data;
+    }
+    return raw as T;
+  }
```

**Scope:** Override is on `BirdeyeAdapter` only. Jupiter, DexScreener, and Meteora adapters are unaffected.

**Safety:** The check `'success' in raw && 'data' in raw` ensures only actual Birdeye wrapper responses are unwrapped. Endpoints that return flat responses (e.g., health check) pass through unchanged.

### Fix 2 — Relaxed token validation (`tokenRepository.ts`)

**Problem:** `validate()` rejected zero values for `liquidity` and `marketCap`:
```typescript
if (data.liquidity != null && data.liquidity <= 0) errors.push('liquidity must be > 0');
if (data.marketCap != null && data.marketCap <= 0) errors.push('marketCap must be > 0');
```

When Birdeye data was missing (due to Fix 1's root cause), these fields defaulted to `0`, causing validation to throw and block `upsert()` entirely. Zero is a valid value for tokens with no on-chain data yet — only negative values indicate corruption.

**Fix:** Changed `<= 0` to `< 0`:

```diff
-    if (data.liquidity != null && data.liquidity <= 0) errors.push('liquidity must be > 0');
-    if (data.marketCap != null && data.marketCap <= 0) errors.push('marketCap must be > 0');
+    if (data.liquidity != null && data.liquidity < 0) errors.push('liquidity must be >= 0');
+    if (data.marketCap != null && data.marketCap < 0) errors.push('marketCap must be >= 0');
```

Updated error messages from "must be > 0" to "must be >= 0" to accurately reflect the new rule.

### Tests Updated (`tokenRepository.test.ts`)

| Old Test | New Test |
|---|---|
| `should reject token with zero liquidity` | `should accept token with zero liquidity` |
| `should reject token with zero marketCap` | `should accept token with zero marketCap` |
| — | `should reject token with negative liquidity` |
| — | `should reject token with negative marketCap` |

---

## Build Result

```
npm run build → tsc → OK (no errors)
npx tsc --noEmit → OK (no errors)
```

## Test Result

```
npm test → vitest run

 Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration   490ms
```

All 48 tests pass, including the 4 updated TokenRepository tests.

---

## Root Cause Chain Status (After Fix)

```
baseIntegration.ts:51                  apiFetch returns raw JSON with wrapper
     ↓
birdeyeAdapter.ts:64-70               [FIX 1] Override unwraps {success, data} → .data
     ↓
marketDataService.ts:40-48            birdeyeData?.liquidity reads REAL value (not undefined)
     ↓
marketDataService.ts:45               marketCap reads REAL value (not undefined)
     ↓
marketDataService.ts:53-55            validate() receives real values
     ↓
tokenRepository.ts:39-40              [FIX 2] Zero values no longer rejected
     ↓
marketDataService.ts:58               ✅ upsert() IS CALLED → token stored
     ↓
repositories: holder, tx, market      ✅ Subsequent flows receive data from filled repos
     ↓
AI engines: score computation         ✅ Real data → real variance across pools
```

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `{success, data}` unwrap breaks if Birdeye changes response format | Low | Check guards for both `success` and `data` keys; if absent, passes through |
| Health endpoint `{success: true}` erroneously unwrapped | None | Health response lacks `data` key → passes through unchanged |
| Other Birdeye endpoints (holders, txs, market data) also wrapped | None | Same override handles all — all Birdeye endpoints use `{success, data}` |
| Zero liquidity/marketCap accepted by validation | Low | Zero means "no data available" — valid state. Negative values still rejected |
| Negative liquidity/marketCap from corrupted data | None | Still rejected: `liquidity < 0` and `marketCap < 0` catch corrupt values |
| Price feed pollution | Low | Tokens with real zero liquidity are rare; filter in engine scoring not validation |
| `getByMint()` returns zero values | Low | Downstream consumers already handle zeros via `?? 0` fallbacks |
| Regression on Jupiter/DexScreener/Meteora | None | Override is on BirdeyeAdapter only — no other adapter modified |

**Overall risk: LOW**

---

## Commit

```
commit on branch release/v1.1.0-rc1
Author: ✗ (DRY_RUN)
Date:   2026-06-10

    fix: unwrap birdeye response and relax token validation
    
    - Override apiFetch in BirdeyeAdapter to unwrap {success, data} wrapper
    - Relax tokenRepository validation: allow zero liquidity/marketCap
    - Update tests to reflect new validation rules
```

**This commit is NOT merged to main. Branch: release/v1.1.0-rc1 (DRY_RUN).**
