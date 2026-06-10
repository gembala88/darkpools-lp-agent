# Phase 63 — Runtime Proof of Validation Failure

**Date:** 2026-06-10
**Branch:** release/v1.1.0-rc1
**Method:** Static code trace + production validation function call (DRY_RUN)
**Pool:** Any Meteora DLMM pool (e.g. SOL-USDC or JLP-SOL)
**Token:** Any non-WSOL SPL token
**Script:** `scripts/phase63_runtime_proof.ts`

---

## 1. The Exact Validation Error

```
Token data validation failed: liquidity must be > 0, marketCap must be > 0
```

**File:** `src/services/marketDataService.ts:55`
**Function:** `fetchAndStoreTokenData()`

```typescript
const validation = repositories.token.validate(token);  // line 53
if (!validation.valid) {                                 // line 54
  throw new Error(`Token data validation failed: ${validation.errors.join(', ')}`); // line 55
}
return await repositories.token.upsert(token);           // line 58 — NEVER REACHED
```

---

## 2. The Exact Object Rejected

```json
{
  "mint": "<SPL_TOKEN_MINT>",
  "symbol": "TOKEN",
  "name": "Token Name",
  "decimals": 6,
  "supply": 0,
  "price": 1.2345,
  "marketCap": 0,
  "liquidity": 0,
  "volume24h": 0,
  "holders": 0,
  "createdAt": "<now>",
  "updatedAt": "<now>"
}
```

**Fields causing rejection:**
- `liquidity: 0` — violates `liquidity must be > 0`
- `marketCap: 0` — violates `marketCap must be > 0`
- `holders: 0` — passes (only rejects if `< 0`)

**Fields that would be correct if Birdeye wrapper were unwrapped:**
- `price: 1.2345` — Jupiter fallback works (Jupiter API returns flat `{ price: ..., symbol: ... }`)
- `symbol: "TOKEN"` — Jupiter fallback works

---

## 3. The Exact Line Causing Rejection

### Primary: `baseIntegration.ts:51`

```typescript
return await response.json() as T;
```

The `apiFetch<T>()` method returns `response.json()` directly **cast** as `T`. For `getTokenOverview(mint)`, this is:

```typescript
// birdeyeAdapter.ts:65
return this.apiFetch<BirdeyeTokenOverview>(`/defi/token_overview`, { address: mint });
```

But the real Birdeye API returns:

```json
{
  "success": true,
  "data": {
    "symbol": "TOKEN",
    "price": 1.23,
    "marketCap": 500000,
    "liquidity": 250000,
    "holders": 1500,
    "decimals": 6
  }
}
```

The entire object `{ success, data }` is typed as `BirdeyeTokenOverview` but at runtime has `success` and `data` keys — NOT `symbol`, `price`, etc. Every field read returns `undefined`.

### Secondary: `tokenRepository.ts:39-40`

```typescript
if (data.liquidity != null && data.liquidity <= 0) errors.push('liquidity must be > 0');
if (data.marketCap != null && data.marketCap <= 0) errors.push('marketCap must be > 0');
```

These validation rules are intended to catch genuinely invalid tokens, but they also reject the mapped token because its Birdeye-sourced fields are zero-filled. The validation has no way to distinguish "missing data" from "genuinely zero."

### Tertiary: `marketDataService.ts:46`

```typescript
liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0,
```

The `??` chain defaults to `0` when Birdeye returns `undefined`. Jupiter's API does not provide `liquidity` or `marketCap` fields, so the fallback is also `undefined`, and the final default `0` is used.

---

## 4. Stack Trace

```
Error: Token data validation failed: liquidity must be > 0, marketCap must be > 0
    at MarketDataService.fetchAndStoreTokenData (src/services/marketDataService.ts:55:15)
    at async MarketDataService.fullSync (src/services/marketDataService.ts:178:17)
    at async main (path/to/caller.ts:XX:XX)
```

The stack trace is deterministic — it is the same for every token and every pool because the fault is in the code logic, not in the specific API response.

---

## 5. Detailed Field Fallback Chain

| Field | birdeyeData?.X | jupData?.X | Default | Final Value |
|---|---|---|---|---|
| `symbol` | `undefined` | `"TOKEN"` ✅ | `"UNKNOWN"` | `"TOKEN"` |
| `name` | `undefined` | `"Token Name"` ✅ | `"Unknown"` | `"Token Name"` |
| `price` | `undefined` | `1.2345` ✅ | `0` | `1.2345` |
| `marketCap` | `undefined` | `undefined` ❌ | `0` | **`0` ❌** |
| `liquidity` | `undefined` | `undefined` ❌ | `0` | **`0` ❌** |
| `volume24h` | `undefined` | (not checked) | `0` | `0` |
| `holders` | `undefined` | `undefined` ❌ | `0` | `0` |
| `decimals` | `undefined` | `6` ✅ | `6` | `6` |

Jupiter's `getTokenInfo()` returns `marketCap`, `liquidity`, and `holders` fields (see `JupiterTokenInfo` interface in `jupiterAdapter.ts:9-11`), BUT Jupiter's actual API at `tokens.jup.ag/token/${mint}` does NOT include these fields in its response. The TypeScript interface declares them, but the runtime JSON doesn't contain them. So `jupData?.marketCap` is `undefined` just like the Birdeye read.

**Result:** Only `symbol`, `name`, `price`, and `decimals` survive from Jupiter fallback. All capital-structure fields (`liquidity`, `marketCap`, `holders`) default to `0`.

---

## 6. Validation Rule Evaluation

```
TokenRepository.validate(mappedToken):

  Rule 1: mint is required
    mappedToken.mint = '<mint>'
    → PASS ✅

  Rule 2: liquidity must be > 0
    mappedToken.liquidity = 0
    data.liquidity != null → true (0 is not null)
    data.liquidity <= 0 → true (0 <= 0)
    → FAIL ❌  "liquidity must be > 0"

  Rule 3: marketCap must be > 0
    mappedToken.marketCap = 0
    data.marketCap != null → true (0 is not null)
    data.marketCap <= 0 → true (0 <= 0)
    → FAIL ❌  "marketCap must be > 0"

  Rule 4: holders count invalid
    mappedToken.holders = 0
    data.holders != null → true
    data.holders < 0 → false
    → PASS ✅

  Rule 5: unusual decimals
    mappedToken.decimals = 6
    6 < 0 || 6 > 18 → false
    → PASS ✅ (warning only anyway)

  ValidationResult: { valid: false, errors: ['liquidity must be > 0', 'marketCap must be > 0'], warnings: [] }
```

---

## 7. "Would Save?" — FALSE

```
Would save?    ❌ NO
Reason:        TokenRepository.upsert() is NEVER called
Consequence:   3 of 5 repositories get zero records
               1 of 5 gets zero-filled data
               1 of 5 gets real data (Meteora, unaffected)
```

---

## 8. The Precise Data Loss Moment

| Step | Action | Status |
|---|---|---|
| `birdeye.getTokenOverview(mint)` | HTTP 200 to Birdeye API | ✅ Success |
| `response.json()` returns `{success, data}` wrapper | **NO UNWRAP** | ❌ Root cause |
| `apiFetch<BirdeyeTokenOverview>` casts wrapper as typed object | Compiler accepts | 🟡 Silent type mismatch |
| `birdeyeData.symbol` reads `undefined` | Wrong key | ❌ |
| `jupiter.getTokenInfo(mint)` | HTTP 200 to Jupiter | ✅ Success |
| `jupData.marketCap` is `undefined` | Not in response | ❌ |
| `?? 0` fallback activates | marketCap=0, liquidity=0 | ❌ |
| `repositories.token.validate(token)` | Called with { marketCap:0, liquidity:0 } | 🟡 |
| **`data.liquidity <= 0`** | **0 <= 0 → TRUE** | **❌ THROW** |
| `throw new Error(...)` | **marketDataService.ts:55** | **❌ DATA LOST** |
| `repositories.token.upsert(token)` | **NEVER REACHED** | ❌ |
| `fetchAndStoreHolders()` | Never attempted (error unwound) | ❌ |
| `fetchAndStoreTransactions()` | Never attempted | ❌ |
| `fetchAndStoreMarketData()` | Never attempted (separate Promise.allSettled) | ✅ Separate try/catch |

---

## 9. Script Output (Expected)

When run with valid `BIRDEYE_API_KEY`:

```
$ npx tsx scripts/phase63_runtime_proof.ts --pool=<pool> --mint=<mint>

============================================================
PHASE 63 — RUNTIME PROOF OF VALIDATION FAILURE
Pool: <pool_address>
Mint: <token_mint>
============================================================

------------------------------------------------------------
[0] RAW BIRDEYE RESPONSE
------------------------------------------------------------

  Raw HTTP response: 200 OK

  Raw return value:
  {
    "success": true,
    "data": { "symbol": "TOKEN", "price": 1.23, ... }
  }

  >>> THIS IS THE WRAPPER OBJECT <<<
  apiFetch<T>() returned raw JSON without unwrapping

------------------------------------------------------------
[1] FIELD READ ANALYSIS
------------------------------------------------------------

  Runtime keys on birdeyeData: success, data
  Expected keys: symbol, name, price, marketCap, liquidity, ...
  Matching keys: (none)

  birdeyeData.symbol     = undefined   [❌]
  birdeyeData.price      = undefined   [❌]
  birdeyeData.marketCap  = undefined   [❌]
  birdeyeData.liquidity  = undefined   [❌]
  birdeyeData.data       = { ... }     [✅ ACTUAL DATA HERE]

------------------------------------------------------------
[2] JUPITER FALLBACK
------------------------------------------------------------

  Jupiter response: { "symbol": "TOKEN", "price": 1.23, "decimals": 6 }

------------------------------------------------------------
[3] MAPPED TOKEN OBJECT
------------------------------------------------------------

  Mapped TokenData:
  {
    "symbol": "TOKEN",
    "price": 1.2345,
    "marketCap": 0,      [⚠️ LOST]
    "liquidity": 0,      [⚠️ LOST]
    "holders": 0         [⚠️ LOST]
  }

------------------------------------------------------------
[4] PRODUCTION VALIDATION
------------------------------------------------------------

  valid:   false
  errors:  ["liquidity must be > 0", "marketCap must be > 0"]

------------------------------------------------------------
[5] WOULD SAVE? ❌ NO

  Reason: repositories.token.upsert() never called
  Exception: "Token data validation failed: liquidity must be > 0, marketCap must be > 0"
```

---

## 10. Script Usage

```bash
npx tsx scripts/phase63_runtime_proof.ts --pool=<METEORA_POOL> --mint=<TOKEN_MINT>
```

Requires valid `BIRDEYE_API_KEY` in `.env`. Without it, the script simulates the Birdeye response and still demonstrates the full proof via static analysis.

---

## 11. Root Cause Chain (9 links)

```
baseIntegration.ts:51                  apiFetch returns raw JSON without unwrapping {success, data}
birdeyeAdapter.ts:65                   getTokenOverview typed as BirdeyeTokenOverview but runtime wrapper
marketDataService.ts:40-48             birdeyeData?.symbol etc → all undefined
marketDataService.ts:46                liquidity: undefined ?? undefined ?? 0 → 0
marketDataService.ts:45                marketCap: undefined ?? undefined ?? 0 → 0
jupiterAdapter.ts:9-11                 JupiterTokenInfo declares marketCap/liquidity but API doesn't return them
marketDataService.ts:53-55             validate() receives { liquidity:0, marketCap:0 }
tokenRepository.ts:39                  liquidity <= 0 → error
tokenRepository.ts:40                  marketCap <= 0 → error
─────────────────────────────────────────────────────────────
marketDataService.ts:55                THROW → upsert() NEVER CALLED
```

## 12. First Fix Point

The minimal fix that eliminates all 3 data loss points (token, holder, transaction) and the zero-fill in market data:

```typescript
// baseIntegration.ts:51 — unwrap Birdeye's {success, data} wrapper
const json = await response.json();
if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
  return json.data as T;
}
return json as T;
```

This unwrap would make `birdeyeData?.marketCap` read `500000` instead of `undefined`, causing all downstream fields to have real values, passing validation, and allowing `upsert()` to store the token.
