# Shadow Deployment Fix Report

## Root Cause

`shadow_deployment.ts` imported from raw TypeScript source path:

```
import { LPIntelligenceService } from '../src/services/lpIntelligenceService.js';
```

This resolves to `./src/services/lpIntelligenceService.js` — a file that **does not exist** because the project compiles TypeScript to `./dist/`. The production system runs `node dist/index.js`, so only `./dist/services/lpIntelligenceService.js` exists at runtime.

## Why ts-node Didn't Help

`ts-node` can execute `.ts` files directly, but ESM import rules require the **literal file extension** in the import path. The `.js` extension forces Node's module resolver to look for a `.js` file. `ts-node` does not magically redirect `.js` imports in `src/` to their compiled counterparts in `dist/`.

## Fix Applied

**Commit:** `4e5bc86`

**Change:** `scripts/shadow_deployment.ts` line 2:

```
- import { LPIntelligenceService } from '../src/services/lpIntelligenceService.js';
+ import { LPIntelligenceService } from '../dist/services/lpIntelligenceService.js';
```

This matches the production import pattern used by `index.js` — both now reference the compiled JS in `dist/`.

## Why Dist Path Is Correct

| Aspect | `src/` path | `dist/` path |
|--------|-------------|--------------|
| File exists | ❌ Only `.ts` source | ✅ Compiled `.js` exists |
| Matches production | ❌ `index.js` uses `dist/` | ✅ Consistent with `index.js` |
| MJS compatibility | ❌ Requires TS loader | ✅ Pure ESM, no loader needed |
| Runtime deps | ❌ No compiled deps | ✅ All AI engines bundled |

`ts-node` will execute the compiled JS, which internally references other compiled JS modules in `dist/`. No TypeScript compilation step is needed.

## Execution

VPS (commit `1ebe199` without fix):
```
git pull origin release/v1.1.0-rc1   # -> pulls 4e5bc86
npx ts-node scripts/shadow_deployment.ts
```
