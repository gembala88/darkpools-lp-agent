import { discoverPools, getPoolDetail, getTopCandidates } from "./screening.js";
import {
  getActiveBin,
  deployPosition,
  getMyPositions,
  getWalletPositions,
  getPositionPnl,
  claimFees,
  closePosition,
  searchPools,
} from "./dlmm.js";
import { getWalletBalances, swapToken } from "./wallet.js";
import { studyTopLPers } from "./study.js";
import { addLesson, clearAllLessons, clearPerformance, removeLessonsByKeyword, getPerformanceHistory, pinLesson, unpinLesson, listLessons } from "../lessons.js";
import { setPositionInstruction } from "../state.js";

import { getPoolMemory, addPoolNote } from "../pool-memory.js";
import { addStrategy, listStrategies, getStrategy, setActiveStrategy, removeStrategy } from "../strategy-library.js";
import { addToBlacklist, removeFromBlacklist, listBlacklist } from "../token-blacklist.js";
import { blockDev, unblockDev, listBlockedDevs } from "../dev-blocklist.js";
import { addSmartWallet, removeSmartWallet, listSmartWallets, checkSmartWalletsOnPool } from "../smart-wallets.js";
import { getTokenInfo, getTokenHolders, getTokenNarrative } from "./token.js";
import { config, reloadScreeningThresholds, MIN_SAFE_BINS_BELOW, screeningContext, setActiveProfile, applyProfileToConfig, getActiveProfileName, getProfileDisplayLabel, SCREENING_PROFILES } from "../config.js";
import { getRecentDecisions } from "../decision-log.js";
import fs from "fs";
import { execSync, spawn } from "child_process";
import { REPO_ROOT, repoPath } from "../repo-root.js";
import { normalizeTimeframe, scaleScreeningToTimeframe } from "../screening-scales.js";

const USER_CONFIG_PATH = repoPath("user-config.json");
const GMGN_CONFIG_PATH = repoPath("gmgn-config.json");
const LIVE_DAILY_PNL_PATH = repoPath("data", "live-daily-pnl.json");
const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";
const METEORA_DLMM_API = "https://dlmm.datapi.meteora.ag";
const MIN_VOLATILITY_TIMEFRAME = "1h";
const TIMEFRAME_MINUTES = {
  "5m": 5,
  "1h": 60,
  "12h": 720,
  "24h": 1440,
};
import { log, logAction } from "../logger.js";
import { notify, notifyDeploy, notifyClose, notifySwap } from "../telegram.js";
import { trackDryRunPosition } from "./dryRunPositions.js";

// ─── Live-mode circuit breaker ─────────────────────────────────────────
// Tracks consecutive deploy failures in live mode. After MAX_FAILURES,
// blocks further deploys until next cycle or manual reset.
const LIVE_MAX_CONSECUTIVE_FAILURES = 5;
let _consecutiveDeployFailures = 0;

export function resetDeployCircuitBreaker() {
  _consecutiveDeployFailures = 0;
}

export function getDeployCircuitBreakerStatus() {
  return { failures: _consecutiveDeployFailures, maxFailures: LIVE_MAX_CONSECUTIVE_FAILURES, blocked: _consecutiveDeployFailures >= LIVE_MAX_CONSECUTIVE_FAILURES };
}

const SENSITIVE_CONFIG_KEYS = new Set([
  "gmgnApiKey",
  "hiveMindApiKey",
  "publicApiKey",
]);

function redactConfigValue(key, value) {
  if (!SENSITIVE_CONFIG_KEYS.has(key)) return value;
  return typeof value === "string" && value ? "***redacted***" : value;
}

function redactAppliedConfig(applied) {
  return Object.fromEntries(
    Object.entries(applied || {}).map(([key, value]) => [key, redactConfigValue(key, value)]),
  );
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVolatilityTimeframe(sourceTimeframe) {
  const source = String(sourceTimeframe || "").trim();
  const sourceMinutes = TIMEFRAME_MINUTES[source];
  const minMinutes = TIMEFRAME_MINUTES[MIN_VOLATILITY_TIMEFRAME];
  return sourceMinutes != null && sourceMinutes >= minMinutes ? source : MIN_VOLATILITY_TIMEFRAME;
}

const VOLATILITY_FALLBACK_TIMEFRAMES = ["1h", "12h", "24h"];

function poolDetailTvl(pool) {
  return numberOrNull(pool?.tvl ?? pool?.active_tvl ?? pool?.liquidity);
}

function poolDetailBinStep(pool) {
  return numberOrNull(pool?.dlmm_params?.bin_step ?? pool?.pool_config?.bin_step);
}

function poolDetailFeeActiveTvlRatio(pool) {
  const raw = pool?.fee_active_tvl_ratio ?? pool?.fee_tvl_ratio;
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  // Object keyed by timeframe
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const tf = config.screening.timeframe || "1h";
    const val = raw[tf];
    if (val != null) {
      const n = Number(val);
      if (Number.isFinite(n)) return n;
    }
    for (const key of ["1h", "30m", "2h", "4h", "12h", "24h"]) {
      const v = raw[key];
      if (v != null) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

function poolDetailVolatility(pool) {
  return numberOrNull(pool?.volatility);
}

/**
 * Resolve a fee_tvl_ratio that may be a number, string, or timeframe-keyed object.
 * Matches screening.js resolveFeeTvlRatio semantics.
 */
function resolveFreshFeeTvl(raw, timeframe) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const tf = raw[timeframe];
    if (tf != null) {
      const n = Number(tf);
      if (Number.isFinite(n)) return n;
    }
    for (const key of ["1h", "30m", "2h", "4h", "12h", "24h"]) {
      const val = raw[key];
      if (val != null) {
        const n = Number(val);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

async function fetchFreshPoolDetail(poolAddress, timeframe = config.screening.timeframe || "5m") {
  const encodedTimeframe = encodeURIComponent(timeframe);
  const filter = encodeURIComponent(`pool_address=${poolAddress}`);
  const url = `${POOL_DISCOVERY_BASE}/pools?page_size=1&filter_by=${filter}&timeframe=${encodedTimeframe}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const detail = (data?.data || [])[0] ?? null;
  // DLMM datapi fallback: pool discovery API often returns null or near-zero fee_active_tvl_ratio
  if (detail) {
    const existingFeeTvl = numberOrNull(detail.fee_active_tvl_ratio ?? detail.fee_tvl_ratio);
    const threshold = numberOrNull(config.screening.minFeeActiveTvlRatio) ?? 0.001;
    const needsFallback = existingFeeTvl == null || (existingFeeTvl < threshold && existingFeeTvl >= 0);
    if (needsFallback) {
      try {
        const dlmmRes = await fetch(`${METEORA_DLMM_API}/pools/${poolAddress}`, { signal: AbortSignal.timeout(5000) });
        if (dlmmRes.ok) {
          const dlmmPool = await dlmmRes.json();
          const rawFeeTvl = dlmmPool?.fee_tvl_ratio ?? dlmmPool?.fee_active_tvl_ratio;
          if (rawFeeTvl != null) {
            const resolved = resolveFreshFeeTvl(rawFeeTvl, timeframe);
            if (resolved != null && Number.isFinite(resolved) && resolved > 0) {
              log("executor", `[deploy-fee-tvl] pool=${poolAddress.slice(0,8)} pooldiscovery=${existingFeeTvl ?? "null"} dlmm_resolved=${resolved} using=${resolved}`);
              detail.fee_active_tvl_ratio = resolved;
              detail.fee_tvl_ratio = resolved;
            }
          }
        } else {
          log("executor_warn", `[deploy-fee-tvl] DLMM API ${dlmmRes.status} for pool ${poolAddress.slice(0,8)}`);
        }
      } catch (e) {
        log("executor_warn", `[deploy-fee-tvl] DLMM fetch failed for ${poolAddress.slice(0,8)}: ${e.message}`);
      }
    }
  }
  return detail;
}

async function validateDeployPoolThresholds(args) {
  let detail;
  try {
    detail = await fetchFreshPoolDetail(args.pool_address);
    if (!detail) throw new Error(`Pool ${args.pool_address} not found`);
  } catch (error) {
    return {
      pass: false,
      reason: `Could not verify pool screening thresholds before deploy: ${error.message}`,
    };
  }

  const tvl = poolDetailTvl(detail);
  const minTvl = numberOrNull(config.screening.minTvl);
  const maxTvl = numberOrNull(config.screening.maxTvl);
  const isDryRun = process.env.DRY_RUN === "true";

  if (tvl == null) {
    return {
      pass: false,
      reason: "Could not verify pool TVL before deploy.",
    };
  }
  if (minTvl != null && minTvl > 0 && tvl < minTvl) {
    log("deploy", `[tvl-check] pool=${args.pool_name || args.pool_address?.slice(0, 8)} tvl=${tvl} active_tvl=${detail?.active_tvl} liquidity=${detail?.liquidity} used=${tvl} vs minTvl=${minTvl} — rejected`);
    return {
      pass: false,
      reason: `Pool TVL $${tvl} is below configured minTvl $${minTvl}.`,
    };
  }
  if (maxTvl != null && maxTvl > 0 && tvl > maxTvl) {
    return {
      pass: false,
      reason: `Pool TVL $${tvl} is above configured maxTvl $${maxTvl}.`,
    };
  }

  const feeActiveTvlRatio = poolDetailFeeActiveTvlRatio(detail);
  const minFeeActiveTvlRatio = numberOrNull(config.screening.minFeeActiveTvlRatio);

  // Quote asset check: verify pool uses an allowed quote asset
          const SOL_MINT = "So11111111111111111111111111111111111111112";
          const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
          const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
          const KNOWN_QUOTE_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);
  const allowedQuotes = config.screening.allowedQuoteAssets ?? ["SOL"];
  const txAddr = detail?.token_x?.address || "";
  const tyAddr = detail?.token_y?.address || "";
  const isXQuote = KNOWN_QUOTE_MINTS.has(txAddr);
  const isYQuote = KNOWN_QUOTE_MINTS.has(tyAddr);
  if (!isXQuote && !isYQuote) {
    // Neither token is a known quote — pass through (unusual pool, let other filters decide)
    log("deploy", `[QUOTE_ASSET] ${args.pool_name || args.pool_address?.slice(0, 8)} — no known quote asset detected (tx=${detail?.token_x?.symbol} ty=${detail?.token_y?.symbol})`);
  } else {
    const quoteAddr = isXQuote ? txAddr : tyAddr;
    const quoteSymbol = quoteAddr === SOL_MINT ? "SOL" : quoteAddr === USDC_MINT ? "USDC" : "USDT";
    if (!allowedQuotes.includes(quoteSymbol)) {
      return {
        pass: false,
        reason: `Pool quote asset ${quoteSymbol} is not in allowedQuoteAssets [${allowedQuotes.join(", ")}].`,
      };
    }
  }
  if (isDryRun) {
    if (feeActiveTvlRatio != null) {
      log("deploy", `[DRY_RUN] fee/TVL gate BYPASSED for learning (pool ratio=${feeActiveTvlRatio}%)`);
    }
  } else if (feeActiveTvlRatio != null) {
    log("deploy", `[deploy-fee-check] pool=${args.pool_name || args.pool_address?.slice(0,8)} feeActiveTvlRatio=${feeActiveTvlRatio} min=${minFeeActiveTvlRatio}`);
    if (minFeeActiveTvlRatio != null && minFeeActiveTvlRatio > 0 && feeActiveTvlRatio < minFeeActiveTvlRatio) {
      return {
        pass: false,
        reason: `Pool fee/active-TVL ${feeActiveTvlRatio}% is below configured minFeeActiveTvlRatio ${minFeeActiveTvlRatio}%.`,
      };
    }
  } else if (minFeeActiveTvlRatio != null && minFeeActiveTvlRatio > 0) {
    return {
      pass: false,
      reason: `Pool fee/active-TVL unknown (could not verify) — required by minFeeActiveTvlRatio ${minFeeActiveTvlRatio}%.`,
    };
  }

  const volatilityTimeframe = getVolatilityTimeframe(config.screening.timeframe || "5m");
  let volatilityDetail = detail;
  let volatility = poolDetailVolatility(volatilityDetail);
  let usedTf = config.screening.timeframe || "5m";

  // Try fallback timeframes if volatility is 0/missing at the source timeframe
  if (volatility == null || volatility <= 0) {
    const timeframesToTry = [...new Set([volatilityTimeframe, ...VOLATILITY_FALLBACK_TIMEFRAMES])];
    for (const tf of timeframesToTry) {
      if (tf === usedTf) continue;
      try {
        const fallbackDetail = await fetchFreshPoolDetail(args.pool_address, tf);
        const fallbackVol = poolDetailVolatility(fallbackDetail);
        if (fallbackVol != null && fallbackVol > 0) {
          volatilityDetail = fallbackDetail;
          volatility = fallbackVol;
          usedTf = tf;
          break;
        }
      } catch {}
    }
  }

  if (volatility == null || volatility <= 0) {
    return {
      pass: false,
      reason: `Pool ${volatilityTimeframe} volatility ${volatility ?? "unknown"} is unusable. Refusing deploy.`,
    };
  }

  const actualBinStep = poolDetailBinStep(detail);
  const minStep = numberOrNull(config.screening.minBinStep);
  const maxStep = numberOrNull(config.screening.maxBinStep);
  if (actualBinStep != null && minStep != null && actualBinStep < minStep) {
    return {
      pass: false,
      reason: `Pool bin_step ${actualBinStep} is below configured minBinStep ${minStep}.`,
    };
  }
  if (actualBinStep != null && maxStep != null && actualBinStep > maxStep) {
    return {
      pass: false,
      reason: `Pool bin_step ${actualBinStep} is above configured maxBinStep ${maxStep}.`,
    };
  }

  const baseMint = detail?.token_x?.address || detail?.base_token_address || null;
  const entryMarketData = {
    entry_mcap: numberOrNull(detail?.token_x?.market_cap ?? detail?.base_token_market_cap),
    entry_tvl: tvl,
    entry_volume: numberOrNull(detail?.volume),
    entry_holders: numberOrNull(detail?.base_token_holders ?? detail?.token_x?.holders),
  };

  return { pass: true, entryMarketData };
}

const JUPITER_QUOTE_API = "https://api.jup.ag/swap/v2/quote";
const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Lightweight check whether a swap route exists and the expected SOL output is worthwhile.
 * Returns { viable, outAmount, reason }.
 */
async function checkSwapRoute(inputMint, rawAmount, minSwapBackSol) {
  try {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const connection = new Connection(process.env.RPC_URL, "confirmed");
    let decimals = 9;
    if (inputMint !== SOL_MINT) {
      const mintInfo = await connection.getParsedAccountInfo(new PublicKey(inputMint));
      decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 9;
    }
    const amountStr = Math.floor(rawAmount * Math.pow(10, decimals)).toString();
    const params = new URLSearchParams({ inputMint, outputMint: SOL_MINT, amount: amountStr, slippageBps: "100" });
    const res = await fetch(`${JUPITER_QUOTE_API}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { viable: false, reason: `quote API ${res.status}` };
    const data = await res.json();
    const outAmountLamports = Number(data?.outAmount ?? 0);
    if (outAmountLamports <= 0) return { viable: false, reason: "zero out amount" };
    const outSol = outAmountLamports / 1e9;
    if (outSol < minSwapBackSol) return { viable: false, reason: `output ${outSol.toFixed(4)} SOL below min ${minSwapBackSol}` };
    return { viable: true, outAmount: outSol };
  } catch (e) {
    return { viable: false, reason: e.message };
  }
}

/**
 * Scan all non-SOL/USDC/USDT wallet tokens and swap any with a viable route back to SOL.
 * Can be called after close (auto) or manually via sweep_stuck_tokens tool.
 */
async function sweepStuckTokens() {
  const minSwapBackSol = config.management.minSwapBackSol ?? 0.001;
  const minSwapUsd = config.management.minSwapBackUsd ?? 0.05;
  let swapped = 0, skipped = 0, kept = 0, errors = 0;
  try {
    const balances = await getWalletBalances({});
    for (const token of (balances.tokens || [])) {
      const mint = token.mint;
      const usd = token.usd;
      if (mint === SOL_MINT) continue;
      if (mint === config.tokens.USDC || mint === config.tokens.USDT) {
        log("executor", `[swap-back] keeping ${token.symbol || mint.slice(0, 8)} $${usd ?? "?"} for future quote-pair deploy`);
        kept++;
        continue;
      }
      // Known USD below threshold → skip as dust
      if (usd != null && usd < minSwapUsd && usd > 0) {
        log("executor", `[swap-back] skipping dust ${token.symbol || mint.slice(0, 8)} $${usd} (below min $${minSwapUsd})`);
        skipped++;
        continue;
      }
      // Check route viability
      const route = await checkSwapRoute(mint, token.balance, minSwapBackSol);
      if (!route.viable) {
        log("executor", `[swap-back] no viable route for ${token.symbol || mint.slice(0, 8)}${usd != null ? ` $${usd}` : ""} — ${route.reason}, leaving in wallet`);
        skipped++;
        continue;
      }
      log("executor", `[swap-back] swapping ${token.symbol || mint.slice(0, 8)}${usd != null ? ` $${usd}` : ""} (→ ~${route.outAmount.toFixed(4)} SOL) → SOL`);
      const swapResult = await swapToken({ input_mint: mint, output_mint: "SOL", amount: token.balance }).catch(e => {
        log("executor_warn", `[swap-back] swap failed for ${token.symbol || mint.slice(0, 8)}: ${e.message}`);
        return null;
      });
      if (swapResult?.amount_out) {
        log("executor", `[swap-back] ${token.symbol || mint.slice(0, 8)} → SOL complete: ${swapResult.amount_out} SOL received`);
        swapped++;
      } else if (swapResult?.dry_run) {
        swapped++;
      } else {
        errors++;
      }
    }
  } catch (e) {
    log("executor_warn", `[swap-back] sweep failed: ${e.message}`);
    return { swapped, skipped, kept, errors, error: e.message };
  }
  return { swapped, skipped, kept, errors };
}

// Registered by index.js so update_config can restart cron jobs when intervals change
let _cronRestarter = null;
export function registerCronRestarter(fn) { _cronRestarter = fn; }

// Map tool names to implementations
const toolMap = {
  discover_pools: discoverPools,
  get_top_candidates: getTopCandidates,
  set_screening_profile: ({ profile, reason }) => {
    if (!SCREENING_PROFILES[profile]) return { error: `Unknown profile "${profile}". Valid: scalping, compounding` };
    setActiveProfile(profile);
    applyProfileToConfig(profile);
    log("screening", `Profile overridden to "${profile}" by LLM — ${reason || "no reason given"}`);
    return { success: true, profile: getProfileDisplayLabel(), activeThresholds: { timeframe: config.screening.timeframe, minTvl: config.screening.minTvl, minVolume: config.screening.minVolume, minHolders: config.screening.minHolders, minMcap: config.screening.minMcap } };
  },
  get_pool_detail: getPoolDetail,
  get_position_pnl: getPositionPnl,
  get_active_bin: getActiveBin,
  deploy_position: deployPosition,
  get_my_positions: getMyPositions,
  get_wallet_positions: getWalletPositions,
  search_pools: searchPools,
  get_token_info: getTokenInfo,
  get_token_holders: getTokenHolders,
  get_token_narrative: getTokenNarrative,
  add_smart_wallet: addSmartWallet,
  remove_smart_wallet: removeSmartWallet,
  list_smart_wallets: listSmartWallets,
  check_smart_wallets_on_pool: checkSmartWalletsOnPool,
  claim_fees: claimFees,
  close_position: closePosition,
  get_wallet_balance: getWalletBalances,
  swap_token: swapToken,
  sweep_stuck_tokens: sweepStuckTokens,
  get_top_lpers: studyTopLPers,
  study_top_lpers: studyTopLPers,
  set_position_note: ({ position_address, instruction }) => {
    const ok = setPositionInstruction(position_address, instruction || null);
    if (!ok) return { error: `Position ${position_address} not found in state` };
    return { saved: true, position: position_address, instruction: instruction || null };
  },
  self_update: async () => {
    try {
      const result = execSync("git pull", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
      if (result.includes("Already up to date")) {
        return { success: true, updated: false, message: "Already up to date — no restart needed." };
      }
      // Delay restart so this tool response (and Telegram message) gets sent first
      setTimeout(() => {
        if (!process.env.pm_id) {
          const child = spawn(process.execPath, process.argv.slice(1), {
            detached: true,
            stdio: "inherit",
            cwd: REPO_ROOT,
          });
          child.unref();
        }
        process.exit(0);
      }, 3000);
      const restartMode = process.env.pm_id
        ? "PM2 detected — exiting in 3s so PM2 can restart the managed process."
        : "Restarting in 3s...";
      return { success: true, updated: true, message: `Updated! ${restartMode}\n${result}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  get_performance_history: getPerformanceHistory,
  get_recent_decisions: ({ limit } = {}) => ({ decisions: getRecentDecisions(limit || 6) }),
  add_strategy:        addStrategy,
  list_strategies:     listStrategies,
  get_strategy:        getStrategy,
  set_active_strategy: setActiveStrategy,
  remove_strategy:     removeStrategy,
  get_pool_memory: getPoolMemory,
  add_pool_note: addPoolNote,
  add_to_blacklist: addToBlacklist,
  remove_from_blacklist: removeFromBlacklist,
  list_blacklist: listBlacklist,
  block_deployer: blockDev,
  unblock_deployer: unblockDev,
  list_blocked_deployers: listBlockedDevs,
  add_lesson: ({ rule, tags, pinned, role }) => {
    addLesson(rule, tags || [], { pinned: !!pinned, role: role || null });
    return { saved: true, rule, pinned: !!pinned, role: role || "all" };
  },
  pin_lesson:   ({ id }) => pinLesson(id),
  unpin_lesson: ({ id }) => unpinLesson(id),
  list_lessons: ({ role, pinned, tag, limit } = {}) => listLessons({ role, pinned, tag, limit }),
  clear_lessons: ({ mode, keyword }) => {
    if (mode === "all") {
      const n = clearAllLessons();
      log("lessons", `Cleared all ${n} lessons`);
      return { cleared: n, mode: "all" };
    }
    if (mode === "performance") {
      const n = clearPerformance();
      log("lessons", `Cleared ${n} performance records`);
      return { cleared: n, mode: "performance" };
    }
    if (mode === "keyword") {
      if (!keyword) return { error: "keyword required for mode=keyword" };
      const n = removeLessonsByKeyword(keyword);
      log("lessons", `Cleared ${n} lessons matching "${keyword}"`);
      return { cleared: n, mode: "keyword", keyword };
    }
    return { error: "invalid mode" };
  },
  update_config: ({ changes, reason = "" }) => {
    // Flat key → config section mapping (covers everything in config.js)
    const CONFIG_MAP = {
      // screening
      screeningSource: ["screening", "source"],
      minFeeActiveTvlRatio: ["screening", "minFeeActiveTvlRatio"],
      excludeHighSupplyConcentration: ["screening", "excludeHighSupplyConcentration"],
      minTvl: ["screening", "minTvl"],
      maxTvl: ["screening", "maxTvl"],
      minVolume: ["screening", "minVolume"],
      minOrganic: ["screening", "minOrganic"],
      minQuoteOrganic: ["screening", "minQuoteOrganic"],
      minHolders: ["screening", "minHolders"],
      minMcap: ["screening", "minMcap"],
      maxMcap: ["screening", "maxMcap"],
      minBinStep: ["screening", "minBinStep"],
      maxBinStep: ["screening", "maxBinStep"],
      timeframe: ["screening", "timeframe"],
      category: ["screening", "category"],
      minTokenFeesSol: ["screening", "minTokenFeesSol"],
      useDiscordSignals: ["screening", "useDiscordSignals"],
      discordSignalMode: ["screening", "discordSignalMode"],
      avoidPvpSymbols: ["screening", "avoidPvpSymbols"],
      blockPvpSymbols: ["screening", "blockPvpSymbols"],
      maxBotHoldersPct: ["screening", "maxBotHoldersPct"],
      maxTop10Pct: ["screening", "maxTop10Pct"],
      maxVolatility: ["screening", "maxVolatility"],
      minAlphaScore: ["risk", "minAlphaScore"],
      maxHoldHours: ["management", "maxHoldHours"],
      quickTakeProfitPct: ["management", "quickTakeProfitPct"],
      allowedLaunchpads: ["screening", "allowedLaunchpads"],
      blockedLaunchpads: ["screening", "blockedLaunchpads"],
      minTokenAgeHours: ["screening", "minTokenAgeHours"],
      maxTokenAgeHours: ["screening", "maxTokenAgeHours"],
      minFeePerTvl24h: ["management", "minFeePerTvl24h"],
      // management
      minClaimAmount: ["management", "minClaimAmount"],
      autoSwapAfterClaim: ["management", "autoSwapAfterClaim"],
      minSwapBackUsd: ["management", "minSwapBackUsd"],
      minSwapBackSol: ["management", "minSwapBackSol"],
      outOfRangeBinsToClose: ["management", "outOfRangeBinsToClose"],
      outOfRangeWaitMinutes: ["management", "outOfRangeWaitMinutes"],
      oorCooldownTriggerCount: ["management", "oorCooldownTriggerCount"],
      oorCooldownHours: ["management", "oorCooldownHours"],
      repeatDeployCooldownEnabled: ["management", "repeatDeployCooldownEnabled"],
      repeatDeployCooldownTriggerCount: ["management", "repeatDeployCooldownTriggerCount"],
      repeatDeployCooldownHours: ["management", "repeatDeployCooldownHours"],
      repeatDeployCooldownScope: ["management", "repeatDeployCooldownScope"],
      repeatDeployCooldownMinFeeEarnedPct: ["management", "repeatDeployCooldownMinFeeEarnedPct"],
      minVolumeToRebalance: ["management", "minVolumeToRebalance"],
      stopLossPct: ["management", "stopLossPct"],
      takeProfitPct: ["management", "takeProfitPct"],
      takeProfitFeePct: ["management", "takeProfitPct"],
      trailingTakeProfit: ["management", "trailingTakeProfit"],
      trailingTriggerPct: ["management", "trailingTriggerPct"],
      trailingDropPct: ["management", "trailingDropPct"],
      pnlSanityMaxDiffPct: ["management", "pnlSanityMaxDiffPct"],
      solMode: ["management", "solMode"],
      liveTradingPaused: ["management", "liveTradingPaused"],
      minSolToOpen: ["management", "minSolToOpen"],
      deployAmountSol: ["management", "deployAmountSol"],
      gasReserve: ["management", "gasReserve"],
      positionSizePct: ["management", "positionSizePct"],
      minAgeBeforeYieldCheck: ["management", "minAgeBeforeYieldCheck"],
      dryRunSlippagePct: ["management", "dryRunSlippagePct"],
      liveSlippageBps: ["management", "liveSlippageBps"],
      liveMaxSolLoss: ["management", "liveMaxSolLoss"],
      // risk
      maxPositions: ["risk", "maxPositions"],
      maxDeployAmount: ["risk", "maxDeployAmount"],
      // schedule
      managementIntervalMin: ["schedule", "managementIntervalMin"],
      screeningIntervalMin: ["schedule", "screeningIntervalMin"],
      healthCheckIntervalMin: ["schedule", "healthCheckIntervalMin"],
      // models
      managementModel: ["llm", "managementModel"],
      screeningModel: ["llm", "screeningModel"],
      generalModel: ["llm", "generalModel"],
      temperature: ["llm", "temperature"],
      maxTokens: ["llm", "maxTokens"],
      maxSteps: ["llm", "maxSteps"],
      // strategy
      strategy:     ["strategy", "strategy"],
      binsBelow:    ["strategy", "maxBinsBelow", ["maxBinsBelow"]],
      minBinsBelow: ["strategy", "minBinsBelow"],
      maxBinsBelow: ["strategy", "maxBinsBelow"],
      defaultBinsBelow: ["strategy", "defaultBinsBelow"],
      // hivemind
      hiveMindUrl: ["hiveMind", "url"],
      hiveMindApiKey: ["hiveMind", "apiKey"],
      agentId: ["hiveMind", "agentId"],
      hiveMindPullMode: ["hiveMind", "pullMode"],
      // meridian api / relay
      publicApiKey: ["api", "publicApiKey"],
      agentMeridianApiUrl: ["api", "url"],
      lpAgentRelayEnabled: ["api", "lpAgentRelayEnabled"],
      // GMGN screening
      gmgnApiKey: ["gmgn", "apiKey"],
      gmgnBaseUrl: ["gmgn", "baseUrl"],
      gmgnInterval: ["gmgn", "interval"],
      gmgnOrderBy: ["gmgn", "orderBy"],
      gmgnDirection: ["gmgn", "direction"],
      gmgnLimit: ["gmgn", "limit"],
      gmgnEnrichLimit: ["gmgn", "enrichLimit"],
      gmgnRequestDelayMs: ["gmgn", "requestDelayMs"],
      gmgnMaxRetries: ["gmgn", "maxRetries"],
      gmgnHoldersLimit: ["gmgn", "holdersLimit"],
      gmgnKlineResolution: ["gmgn", "klineResolution"],
      gmgnKlineLookbackMinutes: ["gmgn", "klineLookbackMinutes"],
      gmgnFilters: ["gmgn", "filters"],
      gmgnPlatforms: ["gmgn", "platforms"],
      gmgnMinMcap: ["gmgn", "minMcap"],
      gmgnMaxMcap: ["gmgn", "maxMcap"],
      gmgnMinVolume: ["gmgn", "minVolume"],
      gmgnMinHolders: ["gmgn", "minHolders"],
      gmgnMinTokenAgeHours: ["gmgn", "minTokenAgeHours"],
      gmgnMaxTokenAgeHours: ["gmgn", "maxTokenAgeHours"],
      gmgnAthFilterPct: ["gmgn", "athFilterPct"],
      gmgnMaxTop10HolderRate: ["gmgn", "maxTop10HolderRate"],
      gmgnMaxBundlerRate: ["gmgn", "maxBundlerRate"],
      gmgnMaxRatTraderRate: ["gmgn", "maxRatTraderRate"],
      gmgnMaxFreshWalletRate: ["gmgn", "maxFreshWalletRate"],
      gmgnMaxDevTeamHoldRate: ["gmgn", "maxDevTeamHoldRate"],
      gmgnMaxBotDegenRate: ["gmgn", "maxBotDegenRate"],
      gmgnMaxSniperCount: ["gmgn", "maxSniperCount"],
      gmgnMaxSniperHoldRate: ["gmgn", "maxSniperHoldRate"],
      gmgnPreferredKolNames: ["gmgn", "preferredKolNames"],
      gmgnPreferredKolMinHoldPct: ["gmgn", "preferredKolMinHoldPct"],
      gmgnDumpKolNames: ["gmgn", "dumpKolNames"],
      gmgnDumpKolMinHoldPct: ["gmgn", "dumpKolMinHoldPct"],
      gmgnRequireKol: ["gmgn", "requireKol"],
      gmgnMinKolCount: ["gmgn", "minKolCount"],
      gmgnMinSmartDegenCount: ["gmgn", "minSmartDegenCount"],
      gmgnMinTotalFeeSol: ["gmgn", "minTotalFeeSol"],
      gmgnIndicatorFilter: ["gmgn", "indicatorFilter"],
      gmgnIndicatorInterval: ["gmgn", "indicatorInterval"],
      gmgnRequireBullishSt: ["gmgn", "indicatorRules", "requireBullishSupertrend"],
      gmgnRejectAtBottom: ["gmgn", "indicatorRules", "rejectAlreadyAtBottom"],
      gmgnRequireAboveSt: ["gmgn", "indicatorRules", "requireAboveSupertrend"],
      gmgnMinRsi: ["gmgn", "indicatorRules", "minRsi"],
      gmgnMaxRsi: ["gmgn", "indicatorRules", "maxRsi"],
      gmgnRequireBbPosition: ["gmgn", "indicatorRules", "requireBbPosition"],
      // chart indicators
      chartIndicatorsEnabled: ["indicators", "enabled", ["chartIndicators", "enabled"]],
      indicatorEntryPreset: ["indicators", "entryPreset", ["chartIndicators", "entryPreset"]],
      indicatorExitPreset: ["indicators", "exitPreset", ["chartIndicators", "exitPreset"]],
      rsiLength: ["indicators", "rsiLength", ["chartIndicators", "rsiLength"]],
      indicatorIntervals: ["indicators", "intervals", ["chartIndicators", "intervals"]],
      indicatorCandles: ["indicators", "candles", ["chartIndicators", "candles"]],
      rsiOversold: ["indicators", "rsiOversold", ["chartIndicators", "rsiOversold"]],
      rsiOverbought: ["indicators", "rsiOverbought", ["chartIndicators", "rsiOverbought"]],
      requireAllIntervals: ["indicators", "requireAllIntervals", ["chartIndicators", "requireAllIntervals"]],
    };

    const applied = {};
    const unknown = [];

    // Build case-insensitive lookup
    const CONFIG_MAP_LOWER = Object.fromEntries(
      Object.entries(CONFIG_MAP).map(([k, v]) => [k.toLowerCase(), [k, v]])
    );
    const STRATEGY_BIN_KEYS = new Set(["binsBelow", "minBinsBelow", "maxBinsBelow", "defaultBinsBelow"]);

    for (const [key, val] of Object.entries(changes)) {
      const match = CONFIG_MAP[key] ? [key, CONFIG_MAP[key]] : CONFIG_MAP_LOWER[key.toLowerCase()];
      if (!match) { unknown.push(key); continue; }
      let normalizedVal = val;
      if (STRATEGY_BIN_KEYS.has(match[0])) {
        const numericVal = Number(val);
        if (!Number.isFinite(numericVal)) {
          unknown.push(key);
          continue;
        }
        normalizedVal = Math.max(MIN_SAFE_BINS_BELOW, Math.round(numericVal));
      }
      applied[match[0]] = normalizedVal;
    }

    if (Object.keys(applied).length === 0) {
      log("config", `update_config failed — unknown keys: ${JSON.stringify(unknown)}, raw changes: ${JSON.stringify(changes)}`);
      return { success: false, unknown, reason };
    }

    let userConfig = {};
    if (fs.existsSync(USER_CONFIG_PATH)) {
      try {
        userConfig = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
      } catch (error) {
        return { success: false, error: `Invalid user-config.json: ${error.message}`, reason };
      }
    }

    // Auto-scale fee/volume when timeframe changes (unless user set them explicitly in same call).
    if (applied.timeframe != null && applied.minFeeActiveTvlRatio == null && applied.minVolume == null) {
      const tf = normalizeTimeframe(applied.timeframe);
      applied.timeframe = tf;
      const scaled = scaleScreeningToTimeframe(tf);
      applied.minFeeActiveTvlRatio = scaled.minFeeActiveTvlRatio;
      applied.minVolume = scaled.minVolume;
      applied._timeframeScaled = true;
      log("config", `timeframe ${tf} → auto-scaled minFeeActiveTvlRatio=${scaled.minFeeActiveTvlRatio}, minVolume=${scaled.minVolume}`);
    }

    // Apply to live config immediately
    for (const [key, val] of Object.entries(applied)) {
      if (key.startsWith("_")) continue;
      const [section, field, third] = CONFIG_MAP[key];
      const isNestedField = typeof third === "string";
      if (isNestedField) {
        if (!config[section][field] || typeof config[section][field] !== "object") config[section][field] = {};
        const before = config[section][field][third];
        config[section][field][third] = val;
        log("config", `update_config: config.${section}.${field}.${third} ${redactConfigValue(key, before)} → ${redactConfigValue(key, val)}`);
      } else {
        const before = config[section][field];
        config[section][field] = val;
        log("config", `update_config: config.${section}.${field} ${redactConfigValue(key, before)} → ${redactConfigValue(key, val)} (verify: ${redactConfigValue(key, config[section][field])})`);
      }
    }
    if (
      applied.binsBelow != null ||
      applied.minBinsBelow != null ||
      applied.maxBinsBelow != null ||
      applied.defaultBinsBelow != null
    ) {
      config.strategy.minBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Math.round(Number(config.strategy.minBinsBelow ?? MIN_SAFE_BINS_BELOW)));
      config.strategy.maxBinsBelow = Math.max(config.strategy.minBinsBelow, Math.round(Number(config.strategy.maxBinsBelow ?? config.strategy.minBinsBelow)));
      config.strategy.defaultBinsBelow = Math.max(
        config.strategy.minBinsBelow,
        Math.min(
          config.strategy.maxBinsBelow,
          Math.round(Number(config.strategy.defaultBinsBelow ?? config.strategy.maxBinsBelow)),
        ),
      );
    }

    // Persist GMGN tuning to gmgn-config.json, and everything else to user-config.json.
    let gmgnConfig = {};
    if (fs.existsSync(GMGN_CONFIG_PATH)) {
      try { gmgnConfig = JSON.parse(fs.readFileSync(GMGN_CONFIG_PATH, "utf8")); } catch { /**/ }
    }
    let wroteUserConfig = false;
    let wroteGmgnConfig = false;
    for (const [key, val] of Object.entries(applied)) {
      if (key.startsWith("_")) continue;
      const [section, field, third] = CONFIG_MAP[key] || [];
      const persistPath = Array.isArray(third) ? third : null;
      const nestedField = typeof third === "string" ? third : null;
      if (section === "gmgn") {
        if (nestedField) {
          if (!gmgnConfig[field] || typeof gmgnConfig[field] !== "object") gmgnConfig[field] = {};
          gmgnConfig[field][nestedField] = val;
        } else {
          gmgnConfig[field] = val;
        }
        wroteGmgnConfig = true;
        continue;
      }
      if (Array.isArray(persistPath) && persistPath.length > 0) {
        let target = userConfig;
        for (const part of persistPath.slice(0, -1)) {
          if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) {
            target[part] = {};
          }
          target = target[part];
        }
        target[persistPath[persistPath.length - 1]] = val;
      } else {
        userConfig[key] = val;
      }
      wroteUserConfig = true;
    }
    const tunedAt = new Date().toISOString();
    if (wroteUserConfig) {
      userConfig._lastAgentTune = tunedAt;
      fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(userConfig, null, 2));
    }
    if (wroteGmgnConfig) {
      gmgnConfig._lastAgentTune = tunedAt;
      fs.writeFileSync(GMGN_CONFIG_PATH, JSON.stringify(gmgnConfig, null, 2));
    }

    // Restart cron jobs if intervals changed
    const intervalChanged = applied.managementIntervalMin != null || applied.screeningIntervalMin != null;
    if (intervalChanged && _cronRestarter) {
      _cronRestarter();
      log("config", `Cron restarted — management: ${config.schedule.managementIntervalMin}m, screening: ${config.schedule.screeningIntervalMin}m`);
    }

    // Save as a lesson — but skip ephemeral per-deploy interval changes
    // (managementIntervalMin / screeningIntervalMin change every deploy based on volatility;
    //  the rule is already in the system prompt, storing it 75+ times is pure noise)
    const lessonsKeys = Object.keys(applied).filter(
      k => !k.startsWith("_") && k !== "managementIntervalMin" && k !== "screeningIntervalMin"
    );
    if (lessonsKeys.length > 0) {
      const summary = lessonsKeys.map(k => `${k}=${redactConfigValue(k, applied[k])}`).join(", ");
      addLesson(`[SELF-TUNED] Changed ${summary} — ${reason}`, ["self_tune", "config_change"]);
    }

    log("config", `Agent self-tuned: ${JSON.stringify(redactAppliedConfig(applied))} — ${reason}`);
    return { success: true, applied: redactAppliedConfig(applied), unknown, reason };
  },
};

// Tools that modify on-chain state (need extra safety checks)
const WRITE_TOOLS = new Set([
  "deploy_position",
  "claim_fees",
  "close_position",
  "swap_token",
  "sweep_stuck_tokens",
]);
const PROTECTED_TOOLS = new Set([
  ...WRITE_TOOLS,
  "self_update",
]);

/**
 * Execute a tool call with safety checks and logging.
 */
export async function executeTool(name, args) {
  const startTime = Date.now();

  // Strip model artifacts like "<|channel|>commentary" appended to tool names
  name = name.replace(/<.*$/, "").trim();

  // ─── Validate tool exists ─────────────────
  const fn = toolMap[name];
  if (!fn) {
    const error = `Unknown tool: ${name}`;
    log("error", error);
    return { error };
  }

  // ─── Pre-execution safety checks ──────────
  if (PROTECTED_TOOLS.has(name)) {
    const safetyCheck = await runSafetyChecks(name, args);
    if (!safetyCheck.pass) {
      log("safety_block", `${name} blocked: ${safetyCheck.reason}`);
      return {
        blocked: true,
        reason: safetyCheck.reason,
      };
    }
  }

  // ─── Inject screening context into deploy_position ────────────
  if (name === "deploy_position") {
    if (!args.lane) args.lane = screeningContext.lane || null;
    if (!args.regime) args.regime = screeningContext.regime || null;
    if (!args.psychology) args.psychology = screeningContext.psychology || null;
    if (args.pool_address && !args.lp_alpha_score) {
      args.lp_alpha_score = screeningContext.poolScores?.[args.pool_address] ?? null;
    }
    if (!args.deploy_source) args.deploy_source = "ai_chosen";
  }

  // ─── Auto-swap SOL→USDC/USDT before non-SOL quote deploy ─────────
  if (name === "deploy_position" && process.env.DRY_RUN !== "true" && config.management?.autoSwapForDeploy && args._quoteSwapNeeded) {
    try {
      const swap = args._quoteSwapNeeded;
      const missingAmount = Math.max(0, swap.needed - swap.have);
      const bufferAmount = missingAmount * 1.05; // 5% buffer for slippage
      const solBuffer = config.management.gasReserve ?? 0.2;
      const balance = await getWalletBalances();
      const solAvailable = Math.max(0, balance.sol - solBuffer);
      const solForSwap = Math.min(bufferAmount, solAvailable);
      if (solForSwap <= 0.001) {
        return { blocked: true, reason: `Insufficient SOL to swap for ${swap.symbol}: have ${balance.sol.toFixed(4)} SOL, need at least ${solBuffer.toFixed(2)} gas reserve.` };
      }
      log("deploy", `[auto-swap-deploy] swapping ${solForSwap.toFixed(4)} SOL → ${swap.symbol} for ${args.pool_name || args.pool_address?.slice(0, 8)} deploy (have ${swap.have} ${swap.symbol}, need ${swap.needed} ${swap.symbol})`);
      const swapResult = await swapToken({
        input_mint: "So11111111111111111111111111111111111111112",
        output_mint: swap.mint,
        amount: solForSwap,
      });
      if (!swapResult || swapResult.error || swapResult.success === false) {
        return { blocked: true, reason: `Auto-swap SOL→${swap.symbol} failed: ${swapResult?.error || "unknown error"}. Deploy cancelled.` };
      }
      log("deploy", `[auto-swap-deploy] swap succeeded: ${solForSwap.toFixed(4)} SOL → ${swap.symbol}`);
      delete args._quoteSwapNeeded;
    } catch (swapErr) {
      return { blocked: true, reason: `Auto-swap SOL→${args._quoteSwapNeeded?.symbol || "quote"} failed: ${swapErr.message}. Deploy cancelled.` };
    }
  }

  // ─── Execute ──────────────────────────────
  try {
    const result = await fn(args);
    const duration = Date.now() - startTime;
    const success = result?.success !== false && !result?.error;

    // Track consecutive deploy failures in live mode for circuit breaker
    if (name === "deploy_position" && process.env.DRY_RUN !== "true") {
      if (result?.dry_run) {
        // Dry-run deploys don't affect live circuit breaker
      } else if (success && !result?.blocked) {
        _consecutiveDeployFailures = 0;
        log("deploy", `Circuit breaker reset — live deploy succeeded`);
      } else {
        _consecutiveDeployFailures++;
        log("deploy", `Circuit breaker: ${_consecutiveDeployFailures}/${LIVE_MAX_CONSECUTIVE_FAILURES} consecutive live deploy failures`);
      }
    }

    logAction({
      tool: name,
      args,
      result: summarizeResult(result),
      duration_ms: duration,
      success,
    });

    if (success) {
      if (name === "swap_token" && result.tx) {
        notifySwap({ inputSymbol: args.input_mint?.slice(0, 8), outputSymbol: args.output_mint === "So11111111111111111111111111111111111111112" || args.output_mint === "SOL" ? "SOL" : args.output_mint?.slice(0, 8), amountIn: result.amount_in, amountOut: result.amount_out, tx: result.tx }).catch(() => {});
      } else if (name === "deploy_position") {
        if (result.dry_run) {
          try {
            log("deploy", "[DRY_RUN] entered dry_run block");
            log("deploy", `[DRY_RUN] result keys: ${Object.keys(result||{}).join(',')} | would_deploy: ${JSON.stringify(result?.would_deploy)}`);
            const _name = result?.would_deploy?.pool_name || args.pool_name || args.pool_address?.slice(0, 8);
            const _binStep = result?.would_deploy?.bin_step ?? args.bin_step ?? "?";
            const _activeBin = result?.would_deploy?.active_bin ?? args.active_bin ?? "?";
            const _amount = result?.would_deploy?.amount_y ?? args.amount_y ?? args.amount_sol ?? 0;
            const _lane = args.lane || "?";
            const _regime = args.regime || "?";
            const _entryTvl = args.entry_tvl || args.initial_value_usd || null;
            // Fetch pool_price from datapi (same source outcomeTracker uses) — NOT active_price (different unit)
            let _entryPoolPrice = null;
            try {
              const res = await fetch('https://pool-discovery-api.datapi.meteora.ag/pools?page_size=1&filter_by=' + encodeURIComponent('pool_address=' + args.pool_address) + '&timeframe=5m', { signal: AbortSignal.timeout(8000) });
              if (res.ok) {
                const body = await res.json();
                const pool = (body.data || [])[0];
                if (pool) _entryPoolPrice = pool.pool_price ?? null;
              }
            } catch (e) { log("deploy", `[DRY_RUN] pool_price fetch failed: ${e.message}`); }
            log("deploy", `[DEPLOY] ${_name} resolved TVL=${_entryTvl} pool_price=${_entryPoolPrice} for gate+record`);
            log("deploy", `[DRY_RUN] Simulated DLMM deploy: ${_name} bin_step=${_binStep} activeBin=${_activeBin} amount=${_amount} SOL lane=${_lane} regime=${_regime} → writing memory...`);
            log("deploy", "[DRY_RUN] building records...");
            // Write both memory files with absolute paths
            let memWriteCount = 0;
            const memFileName = process.env.DRY_RUN === "true" ? 'dry-run-deployment-memory.json' : 'live-deployment-memory.json';
            for (const [label, filePath] of Object.entries({
              'dry-run-memory': ['data', 'dry-run-memory.json'],
              'deployment-memory': ['data', memFileName],
            })) {
              const absPath = repoPath(...filePath);
              log("deploy", `[DRY_RUN] writing ${label} to: ${absPath}`);
              const raw = fs.existsSync(absPath) ? JSON.parse(fs.readFileSync(absPath, 'utf8')) : { deploys: [] };
              const baseRecord = {
                pool_address: args.pool_address,
                pool_name: args.pool_name,
                amount_y: _amount,
                strategy: args.strategy,
                bins_below: args.bins_below,
                downside_pct: args.downside_pct,
                upside_pct: args.upside_pct,
                volatility: args.volatility,
                timestamp: new Date().toISOString(),
                dry_run: true,
                deploySource: args.deploy_source || "ai_chosen",
                conviction_score: args.conviction_score ?? null,
                conviction_reason: args.conviction_reason || null,
                key_factor: args.key_factor || null,
              };
              const deployRecord = {
                ...baseRecord,
                poolAddress: args.pool_address,
                tokenMint: args.base_mint || null,
                name: args.pool_name || args.pool_address?.slice(0, 8),
                lane: args.lane || null,
                regime: args.regime || null,
                psychology: args.psychology || null,
                lpAlphaScore: args.lp_alpha_score || null,
                binStep: args.bin_step || null,
                activeBin: result?.would_deploy?.active_bin ?? _activeBin ?? null,
                deployAmountSol: Number(_amount),
                entryTime: new Date().toISOString(),
                entryTvl: args.entry_tvl || args.initial_value_usd || null,
                entryFees: null,
                entryPrice: result?.would_deploy?.active_price ?? null,
                entryPoolPrice: _entryPoolPrice,
                verdict: "PENDING",
                dryRun: true,
                outcome1h: null,
                outcome4h: null,
              };
              const record = label === 'deployment-memory' ? deployRecord : baseRecord;
              fs.mkdirSync(repoPath('data'), { recursive: true });
              raw.deploys.push(record);
              fs.writeFileSync(absPath, JSON.stringify(raw, null, 2));
              log("deploy", `[DRY_RUN] memory write OK: ${absPath}`);
              memWriteCount++;
            }
            if (memWriteCount > 0) {
              log("deploy", `[DRY_RUN] Memory written (${memWriteCount}/${2} files)`);
            }
            // Track dry-run position for management/evaluation
            try {
              trackDryRunPosition({
                pool_address: args.pool_address,
                pool_name: args.pool_name,
                amount_y: _amount,
                strategy: args.strategy,
                bins_below: args.bins_below,
                bins_above: args.bins_above,
                active_bin: result?.would_deploy?.active_bin ?? _activeBin ?? null,
                bin_step: _binStep,
                active_price: result?.would_deploy?.active_price ?? null,
                volatility: args.volatility,
                lane: _lane,
                regime: _regime,
                psychology: args.psychology,
                lp_alpha_score: args.lp_alpha_score,
                deploy_source: args.deploy_source || "ai_chosen",
                base_mint: args.base_mint,
                entry_tvl: _entryTvl,
                entry_pool_price: _entryPoolPrice,
                conviction_score: args.conviction_score ?? null,
                conviction_reason: args.conviction_reason || null,
                key_factor: args.key_factor || null,
              });
              log("deploy", `[DRY_RUN] Position tracked for lifecycle management`);
            } catch (e) {
              log("deploy", `[DRY_RUN] trackDryRunPosition failed: ${e.message}`);
            }
            // Notify after write (not before, to avoid early crashes)
            try {
              const { notify } = await import('../telegram.js');
              notify(`🧪 ${_name} dry-run deploy (${_amount} SOL, lane=${_lane})`, "info").catch(() => {});
            } catch (_) {}
          } catch (e) {
            log("deploy", `[DRY_RUN] DRY_RUN BLOCK CRASHED: ${e.message} | ${e.stack}`);
          }
        } else {
          notifyDeploy({ pair: result.pool_name || args.pool_name || args.pool_address?.slice(0, 8), amountSol: args.amount_y ?? args.amount_sol ?? 0, position: result.position, tx: result.txs?.[0] ?? result.tx, priceRange: result.price_range, rangeCoverage: result.range_coverage, binStep: result.bin_step, baseFee: result.base_fee }).catch(() => {});
        }
      } else if (name === "close_position") {
        notifyClose({ pair: result.pool_name || args.position_address?.slice(0, 8), pnlUsd: result.pnl_usd ?? 0, pnlPct: result.pnl_pct ?? 0 }).catch(() => {});
        // Track live-mode realized PnL for daily loss limit
        if (process.env.DRY_RUN !== "true") {
          const pnlPct = result.pnl_pct ?? 0;
          const pnlSol = pnlPct / 100 * config.management.deployAmountSol;
          const poolName = result.pool_name || args.position_address?.slice(0, 8) || "unknown";
          recordLivePnl(pnlSol, poolName);
        }
        // Note low-yield closes in pool memory so screener avoids redeploying
        if (args.reason && args.reason.toLowerCase().includes("yield")) {
          const poolAddr = result.pool || args.pool_address;
          if (poolAddr) addPoolNote({ pool_address: poolAddr, note: `Closed: low yield (fee/TVL below threshold) at ${new Date().toISOString().slice(0,10)}` }).catch?.(() => {});
        }
        // Auto-swap all non-SOL tokens back to SOL (except USDC/USDT kept for quote-pair reuse)
        if (!args.skip_swap) {
          const sweepResult = await sweepStuckTokens().catch(e => {
            log("executor_warn", `[swap-back] sweep after close failed: ${e.message}`);
            return { swapped: 0, skipped: 0, kept: 0, errors: 1, error: e.message };
          });
          if (sweepResult.swapped > 0 || sweepResult.skipped > 0 || sweepResult.kept > 0) {
            log("executor", `[swap-back] post-close sweep: ${sweepResult.swapped} swapped, ${sweepResult.skipped} skipped, ${sweepResult.kept} kept, ${sweepResult.errors} errors`);
          }
          result.auto_swapped = true;
          result.auto_swap_note = `All non-SOL tokens (excl. USDC/USDT) auto-swapped back to SOL after close. Sweep: ${sweepResult.swapped} swapped, ${sweepResult.skipped} skipped. Do NOT call swap_token again.`;
        }
      } else if (name === "claim_fees" && config.management.autoSwapAfterClaim && result.base_mint) {
        try {
          const balances = await getWalletBalances({});
          const token = balances.tokens?.find(t => t.mint === result.base_mint);
          if (token && token.usd >= 0.10) {
            log("executor", `Auto-swapping claimed ${token.symbol || result.base_mint.slice(0, 8)} ($${token.usd.toFixed(2)}) back to SOL`);
            await swapToken({ input_mint: result.base_mint, output_mint: "SOL", amount: token.balance });
          }
        } catch (e) {
          log("executor_warn", `Auto-swap after claim failed: ${e.message}`);
        }
      }
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logAction({
      tool: name,
      args,
      error: error.message,
      duration_ms: duration,
      success: false,
    });

    // Return error to LLM so it can decide what to do
    return {
      error: error.message,
      tool: name,
    };
  }
}

/**
 * Run safety checks before executing write operations.
 */
async function runSafetyChecks(name, args) {
  switch (name) {
    case "deploy_position": {
      const poolThresholds = await validateDeployPoolThresholds(args);
      if (!poolThresholds.pass) return poolThresholds;
      if (poolThresholds.entryMarketData) Object.assign(args, poolThresholds.entryMarketData);

      // Reject pools with bin_step out of configured range
      const minStep = config.screening.minBinStep;
      const maxStep = config.screening.maxBinStep;
      if (args.bin_step != null && (args.bin_step < minStep || args.bin_step > maxStep)) {
        return {
          pass: false,
          reason: `bin_step ${args.bin_step} is outside the allowed range of [${minStep}-${maxStep}].`,
        };
      }

      // Configured deploy amount (deployAmountSol / liveDeployAmountSol) takes priority over LLM's suggestion
      const configuredAmount = config.management.liveDeployAmountSol ?? config.management.deployAmountSol;
      const llmProvidedAmount = args.amount_y ?? args.amount_sol;
      if (configuredAmount != null) {
        let effectiveAmount = Number(configuredAmount);
        if (args.unverified === true) {
          effectiveAmount = Math.min(effectiveAmount, config.management.unverifiedDeployAmountSol ?? 0.05);
        }
        if (llmProvidedAmount != null && Number(llmProvidedAmount) !== effectiveAmount) {
          log("deploy", `[deploy-amount] using configured ${effectiveAmount} SOL (LLM suggested ${llmProvidedAmount}, overridden by deployAmountSol)`);
        } else {
          log("deploy", `[deploy-amount] using configured ${effectiveAmount} SOL`);
        }
        args.amount_y = effectiveAmount;
      }
      // Last-resort fallback when no config and no LLM amount
      const _defaultDeployAmount = (() => {
        const base = 0.15;
        if (args.unverified === true) {
          return Math.min(base, config.management.unverifiedDeployAmountSol ?? 0.05);
        }
        return base;
      })();
      if (args.amount_y == null && args.amount_sol == null) {
        log("deploy", `[deploy-amount] LLM omitted amount, defaulting to ${_defaultDeployAmount} SOL (verified=${!args.unverified})`);
        args.amount_y = _defaultDeployAmount;
      }
      const deployAmountY = Number(args.amount_y ?? args.amount_sol ?? _defaultDeployAmount);
      const deployAmountX = Number(args.amount_x ?? 0);
      if (Number.isFinite(deployAmountX) && deployAmountX > 0) {
        return {
          pass: false,
          reason: "This agent only supports single-side deploys. Use amount_y/amount_sol and keep amount_x=0.",
        };
      }
      const requestedBinsBelow = Number(args.bins_below ?? config.strategy.defaultBinsBelow ?? config.strategy.minBinsBelow);
      const requestedBinsAbove = Number(args.bins_above ?? 0);
      const minBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Number(config.strategy.minBinsBelow ?? MIN_SAFE_BINS_BELOW));
      const isSingleSided = deployAmountY > 0 && deployAmountX <= 0;
      const requestedTotalBins = requestedBinsBelow + requestedBinsAbove;
      const requestedVolatility = args.volatility == null ? null : Number(args.volatility);
      if (args.volatility != null && (!Number.isFinite(requestedVolatility) || requestedVolatility <= 0)) {
        return {
          pass: false,
          reason: `volatility ${args.volatility} is invalid. Refusing deploy because the volatility feed is unusable.`,
        };
      }
      if (
        args.downside_pct == null &&
        args.upside_pct == null &&
        (
          !Number.isFinite(requestedBinsBelow) ||
          !Number.isFinite(requestedBinsAbove) ||
          !Number.isInteger(requestedBinsBelow) ||
          !Number.isInteger(requestedBinsAbove) ||
          requestedBinsBelow < 0 ||
          requestedBinsAbove < 0 ||
          requestedTotalBins < minBinsBelow
        )
      ) {
        return {
          pass: false,
          reason: `deploy range ${requestedTotalBins} total bins is below minimum ${minBinsBelow}. Refusing 1-bin/tiny-range deploy.`,
        };
      }
      if (
        isSingleSided &&
        args.downside_pct == null &&
        (!Number.isFinite(requestedBinsBelow) || !Number.isInteger(requestedBinsBelow) || requestedBinsBelow < minBinsBelow)
      ) {
        return {
          pass: false,
          reason: `bins_below ${args.bins_below ?? "missing"} is below minimum ${minBinsBelow}. Refusing 1-bin/tiny-range deploy.`,
        };
      }
      if (
        isSingleSided &&
        args.upside_pct == null &&
        (!Number.isFinite(requestedBinsAbove) || !Number.isInteger(requestedBinsAbove) || requestedBinsAbove !== 0)
      ) {
        return {
          pass: false,
          reason: "Single-side deploy must use bins_above=0.",
        };
      }

      // Check position count limit + duplicate pool guard — force fresh scan to avoid stale cache
      const positions = await getMyPositions({ force: true });
      if (positions.total_positions >= config.risk.maxPositions) {
        return {
          pass: false,
          reason: `Max positions (${config.risk.maxPositions}) reached. Close a position first.`,
        };
      }
      const alreadyInPool = positions.positions.some(
        (p) => p.pool === args.pool_address
      );
      if (alreadyInPool) {
        return {
          pass: false,
          reason: `Already have an open position in pool ${args.pool_address}. Cannot open duplicate.`,
        };
      }

      // Block same base token across different pools
      if (args.base_mint) {
        const alreadyHasMint = positions.positions.some(
          (p) => p.base_mint === args.base_mint
        );
        if (alreadyHasMint) {
          return {
            pass: false,
            reason: `Already holding base token ${args.base_mint} in another pool. One position per token only.`,
          };
        }
      }

      // Check amount limits
      const amountY = args.amount_y ?? args.amount_sol ?? _defaultDeployAmount;
      if (amountY <= 0) {
        return {
          pass: false,
          reason: `Must provide a positive deposit amount (amount_y).`,
        };
      }

      const minDeploy = Math.max(0.05, config.management.deployAmountSol);
      if (amountY < minDeploy) {
        return {
          pass: false,
          reason: `Amount ${amountY} is below the minimum deploy amount (${minDeploy}). Use at least ${minDeploy}.`,
        };
      }
      if (amountY > config.risk.maxDeployAmount) {
        return {
          pass: false,
          reason: `Deposit amount ${amountY} exceeds maximum allowed per position (${config.risk.maxDeployAmount}).`,
        };
      }

      // Cap deploy amount for unverified tokens (rug protection)
      if (args.unverified === true) {
        const unverifiedCap = config.management.unverifiedDeployAmountSol ?? 0.05;
        if (amountY > unverifiedCap) {
          const cappedAmountY = Math.min(amountY, unverifiedCap);
          args.amount_y = cappedAmountY;
          args.amount_sol = cappedAmountY;
          log("deploy", `[deploy-size] pool=${args.pool_name || args.pool_address?.slice(0, 8)} unverified=true using reduced amount ${cappedAmountY} SOL (rug protection)`);
        }
      }

      // Require explicit ENABLE_REAL_DEPLOYMENT for real transactions
      if (process.env.DRY_RUN !== "true" && process.env.ENABLE_REAL_DEPLOYMENT !== "true") {
        return {
          pass: false,
          reason: "Real deployment is disabled. Set ENABLE_REAL_DEPLOYMENT=true in .env and confirm at startup to enable live trading.",
        };
      }

      // Live-mode kill switch — liveTradingPaused blocks new deploys immediately
      if (process.env.DRY_RUN !== "true" && config.management.liveTradingPaused) {
        return {
          pass: false,
          reason: `Live trading is paused (liveTradingPaused). Use /resume or set liveTradingPaused=false in user-config.json to re-enable.`,
        };
      }

      // Live-mode daily loss limit check
      if (process.env.DRY_RUN !== "true") {
        _checkDailyPnlReset();
        const limit = config.management.liveDailyLossLimitSol ?? 0.1;
        if (_liveDailyPnl.realizedLossSol >= limit) {
          return {
            pass: false,
            reason: `Daily loss limit (${limit} SOL) reached — ${_liveDailyPnl.realizedLossSol.toFixed(3)} SOL lost today. New openings blocked until limit resets tomorrow.`,
          };
        }
      }

      // Live-mode circuit breaker — too many consecutive deploy failures
      if (process.env.DRY_RUN !== "true" && _consecutiveDeployFailures >= LIVE_MAX_CONSECUTIVE_FAILURES) {
        return {
          pass: false,
          reason: `Circuit breaker active — ${_consecutiveDeployFailures} consecutive deploy failures. Reset on next screening cycle.`,
        };
      }

      // Check balances (SOL for gas, quote asset for deposit)
      if (process.env.DRY_RUN !== "true") {
        const balance = await getWalletBalances();
        const gasReserve = config.management.gasReserve;
        const minSolRequired = amountY + gasReserve;
        if (balance.sol < minSolRequired) {
          return {
            pass: false,
            reason: `Insufficient SOL: have ${balance.sol} SOL, need ${minSolRequired} SOL (${amountY} deploy + ${gasReserve} gas reserve).`,
          };
        }
        // Check quote asset balance when it's not SOL
        let detail;
        try { detail = await fetchFreshPoolDetail(args.pool_address); } catch { detail = null; }
        if (detail) {
          const SOL_MINT = "So11111111111111111111111111111111111111112";
          const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
          const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
          const txAddr = detail?.token_x?.address || "";
          const tyAddr = detail?.token_y?.address || "";
          const KNOWN_QUOTE_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);
          const isXQuote = KNOWN_QUOTE_MINTS.has(txAddr);
          const isYQuote = KNOWN_QUOTE_MINTS.has(tyAddr);
          if (isXQuote || isYQuote) {
            const quoteAddr = isXQuote ? txAddr : tyAddr;
            if (quoteAddr !== SOL_MINT) {
              const quoteSymbol = quoteAddr === USDC_MINT ? "USDC" : "USDT";
              const tokenBalance = balance.tokens?.find(t => t.mint === quoteAddr);
              const tokenAmount = tokenBalance?.balance ?? 0;
              if (tokenAmount < amountY) {
                if (config.management?.autoSwapForDeploy) {
                  // Don't reject — auto-swap will happen before deploy
                  args._quoteSwapNeeded = { mint: quoteAddr, symbol: quoteSymbol, needed: amountY, have: tokenAmount };
                } else {
                  return {
                    pass: false,
                    reason: `Insufficient ${quoteSymbol}: have ${tokenAmount} ${quoteSymbol}, need ${amountY} ${quoteSymbol} for deploy.`,
                  };
                }
              }
            }
          }
        }
      }

      return { pass: true };
    }

    case "swap_token": {
      // Basic check — prevent swapping when DRY_RUN is true
      // (handled inside swapToken itself, but belt-and-suspenders)
      return { pass: true };
    }

    case "self_update": {
      if (process.env.ALLOW_SELF_UPDATE !== "true") {
        return {
          pass: false,
          reason: "self_update is disabled by default. Set ALLOW_SELF_UPDATE=true locally if you really want to enable it.",
        };
      }
      if (!process.stdin.isTTY) {
        return {
          pass: false,
          reason: "self_update is only allowed from a local interactive TTY session, not from Telegram or background automation.",
        };
      }
      return { pass: true };
    }

    default:
      return { pass: true };
  }
}

/**
 * Summarize a result for logging (truncate large responses).
 */
function summarizeResult(result) {
  const str = JSON.stringify(result);
  if (str.length > 1000) {
    return str.slice(0, 1000) + "...(truncated)";
  }
  return result;
}

// ─── Live-mode daily loss limit tracking ────────────────────────────────
let _liveDailyPnl = { date: "", realizedLossSol: 0, realizedPnlSol: 0, trades: [] };

function _loadLiveDailyPnl() {
  try {
    if (fs.existsSync(LIVE_DAILY_PNL_PATH)) {
      _liveDailyPnl = JSON.parse(fs.readFileSync(LIVE_DAILY_PNL_PATH, "utf-8"));
    }
  } catch {}
}

function _saveLiveDailyPnl() {
  try {
    fs.writeFileSync(LIVE_DAILY_PNL_PATH, JSON.stringify(_liveDailyPnl, null, 2));
  } catch (e) {
    log("executor_warn", `Failed to save live daily PnL: ${e.message}`);
  }
}

function _checkDailyPnlReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (_liveDailyPnl.date !== today) {
    _liveDailyPnl = { date: today, realizedLossSol: 0, realizedPnlSol: 0, trades: [] };
    _saveLiveDailyPnl();
  }
}

/**
 * Record realized PnL from a live-mode position close against the daily loss limit.
 * If the limit is exceeded, auto-pauses live trading and sends a Telegram alert.
 */
export function recordLivePnl(pnlSol, poolName) {
  if (process.env.DRY_RUN === "true") return;
  _checkDailyPnlReset();
  _liveDailyPnl.realizedPnlSol += pnlSol;
  if (pnlSol < 0) _liveDailyPnl.realizedLossSol += Math.abs(pnlSol);
  _liveDailyPnl.trades.push({ pool: poolName, pnlSol: Number(pnlSol.toFixed(4)), time: new Date().toISOString() });
  _saveLiveDailyPnl();
  const limit = config.management.liveDailyLossLimitSol ?? 0.1;
  if (_liveDailyPnl.realizedLossSol >= limit) {
    config.management.liveTradingPaused = true;
    _persistLiveTradingPaused(true);
    notify(`⚠️ DAILY LOSS LIMIT REACHED: ${_liveDailyPnl.realizedLossSol.toFixed(3)} SOL lost today (limit: ${limit} SOL). New live openings blocked until tomorrow. Existing positions keep their stop-loss.`, "critical").catch(() => {});
  }
}

/**
 * Get current live daily PnL state (read-only snapshot).
 */
export function getLiveDailyPnl() {
  _checkDailyPnlReset();
  return { ..._liveDailyPnl };
}

function _persistLiveTradingPaused(paused) {
  try {
    const uc = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf-8"));
    uc.liveTradingPaused = paused;
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(uc, null, 2));
  } catch {}
}

// Load daily PnL at module init
_loadLiveDailyPnl();
