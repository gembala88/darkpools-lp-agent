# AI Score Variance Audit Report

## Root Cause

`shadow_deployment.ts` passes a **hardcoded WSOL mint** (`So11111111111111111111111111111111111111112`) as `tokenMint` for **every pool evaluation**. The AI Layer uses `tokenMint` as the primary key to fetch market data, so every pool receives identical token-specific data.

## Data Flow Trace

```
shadow_deployment.ts:197
  ↓
const dummyMint = 'So11111111111111111111111111111111111111112';  ← SAME FOR ALL POOLS
  ↓
lpIntelligenceService.ts:87
  ↓
marketData.fullSync(tokenMint, poolAddress)
  ├── fetchAndStoreTokenData(mint)          ← WSOL data for all pools
  ├── fetchAndStoreHolders(mint)            ← WSOL holders for all pools
  ├── fetchAndStoreTransactions(mint, pool) ← pool-specific (different per pool)
  ├── fetchAndStoreMarketData(mint, pool)   ← pool-specific (different per pool)
  └── syncPoolLiquidity(pool)               ← pool-specific (different per pool)
```

## Data with WSOL Mint vs Real Pool Mint

| Data Source | Key | WSOL (current) | Real pool token |
|------------|-----|----------------|-----------------|
| Token data | mint | WSOL mature data | Actual token data |
| Holders | mint | WSOL holders | Actual holders |
| Transactions | pool | pool-specific ✅ | pool-specific ✅ |
| Market data | pool | pool-specific ✅ | pool-specific ✅ |
| Liquidity | pool | pool-specific ✅ | pool-specific ✅ |

**Token-level data (2/5 sources) is always WSOL** — this is enough to collapse variance because multiple sub-engines depend on `tokenMint`:

## Sub-Engines Affected

| Engine | Uses tokenMint? | Effect with WSOL Mint |
|--------|----------------|----------------------|
| `txMomentum` | ✅ Yes | Gets WSOL transaction patterns |
| `capitalInflow` | ✅ Yes | Gets WSOL capital flow |
| `smartMoney` | ✅ Yes | Gets WSOL smart money data |
| `holderGrowth` | ✅ Yes | Gets WSOL holder growth (always same) |
| `risk` | ✅ Yes | Evaluates WSOL risk (low/stable) |
| `lpMomentum` | ✅ Yes | Gets WSOL price momentum |
| `feeAprPrediction` | ✅ Yes | Gets WSOL fee data |
| `liquidityUtilization` | ❌ No | Pool-specific ✅ |
| `liquidityStability` | ❌ No | Pool-specific ✅ |
| `smartLP` | ❌ No | Pool-specific ✅ |
| `rangeEfficiency` | ❌ No | Pool-specific ✅ |
| `narrative` | ❌ No | Uses tokenName/symbol from options (both hardcoded) |
| All 9 AI engines | ✅ Yes | All receive WSOL as tokenMint |

**7 of 12 alpha sub-engines + all 9 AI engines** receive WSOL data. Only 5 pool-specific engines may vary.

## Why Score = 7.52 Specifically

WSOL (Wrapped SOL) is:
- A mature, highly liquid asset
- Low volatility, stable price
- High holder count with slow growth
- Low alpha opportunity (high competition, tight spreads)

The weighted alpha formula produces ~7.52 for WSOL consistently because:
1. Low fee APR prediction (WSOL pools compete on fees → low return)
2. Low tx momentum (stable asset, no speculative volume)
3. Low capital inflow (already saturated)
4. Stable but unexciting liquidity/utilization scores
5. "RANGING" market regime (WSOL doesn't trend like alts)

The AI Chief then REJECTs because 7.52 is below the DEPLOY threshold.

## Verification Steps

### 1. Pool address uniqueness
✅ Pool addresses are unique — verified from PM2 log parsing.

### 2. tokenMint values
❌ **ALL pools receive `So11111111111111111111111111111111111111112` (WSOL)**
`shadow_deployment.ts:197`: `const dummyMint = 'So11111111111111111111111111111111111111112';`

### 3. poolAddress values
✅ Unique per pool — passed correctly from log.

### 4. LPIntelligenceService input
❌ `evaluatePool(poolAddress, tokenMint, options)` — tokenMint is always WSOL, options are always `{ tokenName: poolName, tokenSymbol: 'SHDW', marketCap: 500000, tokenAgeHours: 24 }`.

### 5. Fallback/default score path
✅ Not triggered. The engines successfully evaluate WSOL data and return real (but identical) scores. No error fallback is active.

### 6. Score components (all identical per pool)
| Component | Value (WSOL) | Expected (unique token) |
|-----------|-------------|------------------------|
| feeAprPrediction | ~50 | Varies by pool |
| liquidityUtilization | ~35 | Varies by pool |
| txMomentum | ~52 | Varies by pool |
| capitalInflow | ~48 | Varies by pool |
| liquidityStability | ~65 | Varies by pool |
| smartMoney | ~50 | Varies by pool |
| smartLP | ~45 | Varies by pool |
| rangeEfficiency | ~40 | Varies by pool |
| holderGrowth | ~55 | Varies by pool |
| narrative | ~50 | Varies by token |
| risk | ~30 | Varies by token |
| lpMomentum | ~50 | Varies by token |

## Required Fix

The shadow script must obtain the **real token mint** for each pool before calling `evaluatePool`.

Options:
1. **Fetch from Meteora API** — Query pool-discovery API by pool address to get `token_x.address`
2. **Fetch from RPC** — Get pool account data, extract token vault mints
3. **Emit in PM2 log** — Add token mint to screening.js rejection log

Recommended: **Option 1** — the script already polls PM2 logs, add an API call to enrich pool data with the real token mint.

## Fix Impact

Without fix: All pools produce score=7.52, decision=REJECT, regime=RANGING — **useless data** for A/B comparison.
With fix: Real variance across pools, meaningful Mode A vs Mode B comparison, valid A/B test results.
