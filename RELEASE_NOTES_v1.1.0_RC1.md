# Release Notes — v1.1.0-rc1

**Release candidate 1 for paper trading.** Not approved for real capital deployment.

---

## Architecture Changes

- Added **AI Intelligence Layer** — 14 new files, 2,879 lines of code
- Pipeline: LpAlphaScoreEngine → 9 AI Engines (parallel) → DynamicWeightEngine → AIAnalystLayer → MultiAgentSystem → ChiefAiDecisionSystem → NoDeployFilterV2
- All engines run locally; no external AI APIs called for market analysis
- Non-blocking design — engine failures degrade confidence gracefully (0→neutral, not 0→reject)

## New Engines

### src/ai/marketRegimeEngine.ts
Classifies live conditions into 7 regimes using on-chain volume, buy pressure, and tx velocity. Calibrated for Meteora DLMM pools with condition-ordering-aware detection (DISTRIBUTION checked before TRENDING_BEARISH).

### src/ai/poolActivityEngine.ts
Measures pool health via transaction velocity. DLMM-calibrated thresholds: VERY_ACTIVE >6, ACTIVE >2, NORMAL >0.5. Gates whale exit analysis to prevent false positives on dead pools.

### src/ai/accumulationDetector.ts
Detects smart money accumulation via holder growth, buy/sell ratio divergence, and volume trends. Outputs bullish/bearish/neutral signal with confidence score.

### src/ai/whaleExitProbabilityEngine.ts
Multi-path detection for top-holder sell risk:
- Concentration threshold breach (≥35% / ≥60%)
- Total sell volume >50k USD
- Sell pressure (sells > 2× buys)
- Combined probability scoring

### src/ai/marketPsychologyEngine.ts
Classifies market sentiment into 7 tiers (CAPITULATION through EUPHORIA) using buy/sell ratios. Includes MILD_FEAR and MILD_GREED for intermediate states.

### src/ai/smartMoneyFlowEngine.ts
Tracks aggregated smart wallet activity — top-holder position changes, KOL wallet transactions, net flow direction. 100% accuracy in live validation.

### src/ai/dynamicWeightEngine.ts
Adjusts engine weights dynamically based on market confidence. Preserves conservative deployment bias by down-weighting during uncertainty.

### src/ai/aiAnalystLayer.ts
Consolidates all engine outputs, computes combined score with confidence (max(5, 100 - stdDev*3)). Confidence calibration ensures no 0% or 100% outliers.

### src/ai/multiAgentSystem.ts
Runs agents with randomized weight variations, builds consensus via mean agreement. Agent doubt uses `Math.sqrt(variance)*2` for correct statistical scaling.

### src/ai/chiefAiDecisionSystem.ts
Final decision authority. Produces one of DEPLOY, SIMULATE, SKIP, or WATCHLIST. SIMULATE threshold >=40 (moderate confidence), DEPLOY requires >60 confidence + zero warnings.

### Supporting Files
- `src/ai/deploymentMemoryEngine.ts` — tracks deploy history for context
- `src/ai/selfLearningEngine.ts` — adjusts thresholds based on closed-position outcomes
- `src/ai/aiCandleIntelligenceEngine.ts` — candle-based pattern detection
- `src/ai/index.ts` — engine registry and exports

## Validation Results

| Validation Method | Result |
|---|---|
| TypeScript compilation | ✅ Zero errors |
| ESLint | ✅ Pass |
| Unit tests (46/46) | ✅ Pass |
| Fixed-scenario simulation (42/42) | ✅ 100% |
| Live randomized validation (360 evals) | ✅ 84.7–100% engine accuracy |
| False positive rate | ✅ < 20% |
| False negative rate | ✅ Conservative bias (SKIP > DEPLOY) |
| Readiness score | 96/100 |

## Safety Changes

- **Dual-gate deployment protection**: `DRY_RUN=true` (paper mode) + `ENABLE_REAL_DEPLOYMENT=true` (explicit opt-in) both required for live trading
- `.env.example` now defaults to `DRY_RUN=true` and `ENABLE_REAL_DEPLOYMENT=false`
- Startup logs a warning when real deployment is blocked
- `runSafetyChecks()` in executor.js blocks deploy if ENABLE_REAL_DEPLOYMENT is not "true"

## Audit Fixes

- Removed 2 unused imports
- Removed 2 unreachable guards (non-negative percentage checks)
- Removed 3 unused engine instances in lpAlphaScoreEngine
- Fixed `calculateAcceleration` to compute actual second derivative
- Lowered EUPHORIA volumeSpike threshold from >8 to >6 (DLMM calibration)
- Fixed condition ordering: DISTRIBUTION before TRENDING_BEARISH (was stealing 100% of Distribution cases)

## Known Limitations

- **RC1 is paper trading only** — no real capital deployment
- 7-day validation incomplete (24h completed, 6 days remaining)
- Real-time RPC feed not tested under sustained load
- Slippage and execution modeling not validated
- No simulated balance tracking — DRY_RUN uses real wallet data but skips transactions
- `/close N` and `/closeall` Telegram commands bypass `executeTool()` safety checks (still protected by DRY_RUN gate in dlmm.js)
- HiveMind has no explicit disable flag (blank values fall back to Agent Meridian defaults)

## Next Roadmap

### v1.1.0-rc2 (future)
- Complete 7-day live validation
- Slippage and execution modeling
- Simulated balance tracking for paper mode
- Rate limiting for position close operations

### v1.2.0 (future, no timeline)
- Real capital deployment after full validation
- Multi-wallet support
- Advanced stop-loss strategies

---

**Do not merge to main. Do not enable real deployment.**
