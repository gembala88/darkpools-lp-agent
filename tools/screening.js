import { config } from "../config.js";
import { isBlacklisted } from "../token-blacklist.js";
import { isDevBlocked, getBlockedDevs } from "../dev-blocklist.js";
import { log } from "../logger.js";
import { isBaseMintOnCooldown, isPoolOnCooldown } from "../pool-memory.js";
import { confirmIndicatorPreset } from "./chart-indicators.js";
import { discoverGmgnPools } from "./gmgn.js";

const DATAPI_JUP = "https://datapi.jup.ag/v1";
const METEORA_DLMM_API = "https://dlmm.datapi.meteora.ag";

const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";
const MIN_VOLATILITY_TIMEFRAME = "1h";
const TIMEFRAME_MINUTES = {
  "5m": 5,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "12h": 720,
  "24h": 1440,
};
const PVP_SHORTLIST_LIMIT = 2;
const PVP_RIVAL_LIMIT = 2;

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const KNOWN_QUOTE_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

function isQuoteMint(address) {
  return KNOWN_QUOTE_MINTS.has(address);
}

function getQuoteSymbol(address) {
  if (address === SOL_MINT) return "SOL";
  if (address === USDC_MINT) return "USDC";
  if (address === USDT_MINT) return "USDT";
  return null;
}

// Resolve fee_tvl_ratio from raw API pool, which may return an object keyed by timeframe
function resolveFeeTvlRatio(rawPool, timeframe) {
  const raw = rawPool?.fee_active_tvl_ratio ?? rawPool?.fee_tvl_ratio;
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  // Object keyed by timeframe: pick the requested timeframe or fall back to first available
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const tf = raw[timeframe];
    if (tf != null) {
      const n = Number(tf);
      if (Number.isFinite(n)) return n;
    }
    // Fallback: try "1h", then first numeric value
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

// Volume history cache (60s TTL, keyed by pool address)
const _volHistoryCache = new Map();
const VOL_HISTORY_CACHE_TTL = 60_000;

async function fetchPoolVolumeHistory(poolAddress) {
  const cached = _volHistoryCache.get(poolAddress);
  if (cached && Date.now() - cached.ts < VOL_HISTORY_CACHE_TTL) return cached.data;
  try {
    const res = await fetch(`${METEORA_DLMM_API}/pools/${poolAddress}/volume/history?timeframe=1h`);
    if (!res.ok) return null;
    const data = await res.json();
    _volHistoryCache.set(poolAddress, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

function computeVolumeAcceleration(historyData) {
  if (!historyData) return null;
  const buckets = Array.isArray(historyData.data) ? historyData.data : null;
  if (!Array.isArray(buckets) || buckets.length < 6) return null;

  const entries = buckets
    .map((b) => ({
      ts: Number(b.timestamp ?? 0),
      vol: Number(b.volume ?? 0),
    }))
    .filter((e) => e.ts > 0)
    .sort((a, b) => a.ts - b.ts);

  if (entries.length < 6) return null;

  const recent = entries.slice(-3);
  const prior = entries.slice(-6, -3);

  const recentAvg = recent.reduce((s, e) => s + e.vol, 0) / recent.length;
  const priorAvg = prior.reduce((s, e) => s + e.vol, 0) / prior.length;

  // All-zero recent volume → dead/stale pool
  if (recentAvg <= 0) {
    return { trend: "inactive", ratio: 0, recentAvg: 0, priorAvg: Math.round(priorAvg) };
  }

  if (priorAvg <= 0) {
    // Prior window was dead but recent has volume → new activity
    return { trend: "accelerating", ratio: 999, recentAvg: Math.round(recentAvg), priorAvg: 0 };
  }

  const ratio = recentAvg / priorAvg;

  const accelRatio = config.screening.volumeAccelRatio ?? 1.5;
  const decelRatio = config.screening.volumeDecelRatio ?? 0.5;
  let trend;
  if (ratio >= accelRatio) {
    trend = "accelerating";
  } else if (ratio <= decelRatio) {
    trend = "decelerating";
  } else {
    trend = "stable";
  }

  return { trend, ratio: Math.round(ratio * 100) / 100, recentAvg: Math.round(recentAvg), priorAvg: Math.round(priorAvg) };
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function scoreCandidate(pool) {
  if (Number.isFinite(Number(pool.gmgn_score))) {
    return Number(pool.gmgn_score) + Number(pool.fee_active_tvl_ratio || 0) * 1000;
  }
  const feeTvl = Number(pool.fee_active_tvl_ratio || 0);
  const volume = Number(pool.volume_window || 0);
  const organic = Number(pool.organic_score || 0);
  const holders = Number(pool.holders || 0);
  const feeWindow = Number(pool.fee_window || 0);
  const uniqueTraders = Number(pool.unique_traders || 0);
  // fee_tvl ratio is the strongest predictor of LP profitability
  // fee_window confirms actual fees earned in the window
  // volume + unique_traders confirm genuine activity
  return feeTvl * 20000 + feeWindow * 100 + volume / 10 + uniqueTraders * 20 + organic * 5 + holders / 200;
}

function numeric(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isUsableVolatility(value) {
  const n = numeric(value);
  return n != null && n > 0;
}

function includesCaseInsensitive(values, value) {
  if (!Array.isArray(values) || values.length === 0 || !value) return false;
  const needle = String(value).toLowerCase();
  return values.some((entry) => String(entry).toLowerCase() === needle);
}

function getPoolLaunchpad(pool) {
  const base = pool?.token_x || {};
  return base?.launchpad ||
    base?.launchpad_platform ||
    pool?.base_token_launchpad ||
    pool?.launchpad ||
    pool?.launchpad_platform ||
    null;
}

function getPoolBaseMint(pool) {
  return pool?.token_x?.address ||
    pool?.base_token_address ||
    pool?.base_mint ||
    pool?.base?.mint ||
    null;
}

function getVolatilityTimeframe(sourceTimeframe) {
  const source = String(sourceTimeframe || "").trim();
  const sourceMinutes = TIMEFRAME_MINUTES[source];
  const minMinutes = TIMEFRAME_MINUTES[MIN_VOLATILITY_TIMEFRAME];
  const baseTf = sourceMinutes != null && sourceMinutes >= minMinutes ? source : MIN_VOLATILITY_TIMEFRAME;
  // Return just the base timeframe — fallback logic on actual fetched values happens in applyVolatilityTimeframe
  return baseTf;
}

const VOLATILITY_FALLBACK_TIMEFRAMES = ["1h", "12h", "24h"];

function getRawPoolScreeningRejectReason(pool, s) {
  const base = pool?.token_x || {};
  const quote = pool?.token_y || {};
  const binStep = numeric(pool?.dlmm_params?.bin_step);
  const tvl = numeric(pool?.tvl ?? pool?.active_tvl);
  const feeActiveTvlRatio = numeric(resolveFeeTvlRatio(pool, s.timeframe || "1h"));
  const volatility = numeric(pool?.volatility);
  const volume = numeric(pool?.volume);
  const holders = numeric(pool?.base_token_holders);
  const mcap = numeric(base?.market_cap);
  const baseOrganic = numeric(base?.organic_score);
  const quoteOrganic = numeric(quote?.organic_score);
  const launchpad = getPoolLaunchpad(pool);
  const createdAt = numeric(base?.created_at);

  if (s.excludeHighSupplyConcentration && pool?.base_token_has_high_supply_concentration === true) {
    return "base token has high supply concentration";
  }
  if (pool?.base_token_has_critical_warnings === true) return "base token has critical warnings";
  if (pool?.quote_token_has_critical_warnings === true) return "quote token has critical warnings";
  if (pool?.base_token_has_high_single_ownership === true) return "base token has high single ownership";
  if (pool?.pool_type && pool.pool_type !== "dlmm") return `pool_type ${pool.pool_type} is not dlmm`;

  if (mcap != null && mcap < s.minMcap) return `mcap ${mcap} below minMcap ${s.minMcap}`;
  if (mcap != null && mcap > s.maxMcap) return `mcap ${mcap} above maxMcap ${s.maxMcap}`;
  if (holders == null || holders < s.minHolders) return `holders ${holders ?? "unknown"} below minHolders ${s.minHolders}`;
  if (volume == null || volume < s.minVolume) return `volume ${volume ?? "unknown"} below minVolume ${s.minVolume}`;
  if (tvl == null || tvl < s.minTvl) return `TVL ${tvl ?? "unknown"} below minTvl ${s.minTvl}`;
  if (s.maxTvl != null && tvl > s.maxTvl) return `TVL ${tvl} above maxTvl ${s.maxTvl}`;
  // Skip bin_step filter for non-DLMM pools (Raydium CLMM, Orca Whirlpool, etc.)
  // These use different tick/spacing mechanics incompatible with Meteora's bin_step
  if (pool?.dex_source === true || pool?.dex_source == null) {
    if (binStep == null || binStep < s.minBinStep) return `bin_step ${binStep ?? "unknown"} below minBinStep ${s.minBinStep}`;
    if (binStep > s.maxBinStep) return `bin_step ${binStep} above maxBinStep ${s.maxBinStep}`;
  }
  if (!isUsableVolatility(volatility)) return `volatility ${volatility ?? "unknown"} unusable`;
  if (feeActiveTvlRatio == null || feeActiveTvlRatio < s.minFeeActiveTvlRatio) {
    return `fee/active-TVL ${feeActiveTvlRatio ?? "unknown"} below minFeeActiveTvlRatio ${s.minFeeActiveTvlRatio}`;
  }
  if (baseOrganic == null || baseOrganic < s.minOrganic) {
    return `base organic ${baseOrganic ?? "unknown"} below minOrganic ${s.minOrganic}`;
  }
  if (quoteOrganic == null || quoteOrganic < s.minQuoteOrganic) {
    return `quote organic ${quoteOrganic ?? "unknown"} below minQuoteOrganic ${s.minQuoteOrganic}`;
  }
  if (
    pool?.discord_signal &&
    Array.isArray(s.allowedLaunchpads) &&
    s.allowedLaunchpads.length > 0 &&
    launchpad &&
    !includesCaseInsensitive(s.allowedLaunchpads, launchpad)
  ) {
    return `launchpad ${launchpad} not in allow-list`;
  }
  if (includesCaseInsensitive(s.blockedLaunchpads, launchpad)) {
    return `blocked launchpad (${launchpad})`;
  }
  if (s.minTokenAgeHours != null) {
    const maxCreatedAt = Date.now() - s.minTokenAgeHours * 3_600_000;
    if (createdAt == null || createdAt > maxCreatedAt) return `token age below minTokenAgeHours ${s.minTokenAgeHours}`;
  }
  if (s.maxTokenAgeHours != null) {
    const minCreatedAt = Date.now() - s.maxTokenAgeHours * 3_600_000;
    if (createdAt == null || createdAt < minCreatedAt) return `token age above maxTokenAgeHours ${s.maxTokenAgeHours}`;
  }
  return null;
}

/**
 * Check if a token has a corresponding Meteora DLMM pool.
 * DexScreener pools are regular AMM — get_active_bin FAILS on them.
 * If found, returns the Meteora pool data to replace the DexScreener entry.
 */
async function findMeteoraDlmmPool(mint) {
  try {
    const filters = ["pool_type=dlmm"].filter(Boolean).join("&&");
    const data = await fetchPoolDiscoveryPage({
      page_size: 50,
      filters,
      timeframe: "24h",
      category: "all",
    });
    const raw = Array.isArray(data.data) ? data.data : [];
    const match = raw.find(p => p.token_x?.address === mint || p.token_y?.address === mint);
    if (match) {
      return { pool_address: match.pool_address, ...match };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchDiscordSignalCandidates() {
  const res = await fetch(`${config.api.url}/signals/discord/candidates`, {
    headers: config.api.publicApiKey ? { "x-api-key": config.api.publicApiKey } : {},
  });
  if (!res.ok) throw new Error(`discord signal candidates ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

async function fetchPoolDiscoveryPage({ page_size, filters, timeframe, category, sortBy }) {
  let url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=${page_size}` +
    `&filter_by=${encodeURIComponent(filters)}` +
    `&timeframe=${timeframe}` +
    `&category=${category}`;

  if (sortBy) {
    url += `&sort_by=${encodeURIComponent(sortBy)}`;
  }

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function fetchPoolDiscoveryDetail({ poolAddress, timeframe }) {
  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=1` +
    `&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}` +
    `&timeframe=${timeframe}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Pool detail API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return (data.data || [])[0] ?? null;
}

async function applyVolatilityTimeframe(rawPools, sourceTimeframe) {
  if (!Array.isArray(rawPools) || rawPools.length === 0) return rawPools;
  const volatilityTimeframe = getVolatilityTimeframe(sourceTimeframe);

  // Tag primary-timeframe values on every pool before any overwrite
  for (const pool of rawPools) {
    if (!pool) continue;
    pool[`volume_${sourceTimeframe}`] = pool.volume ?? null;
    pool[`volatility_${sourceTimeframe}`] = pool.volatility ?? null;
    pool.volatility_timeframe = volatilityTimeframe;
  }

  if (sourceTimeframe === volatilityTimeframe) return rawPools;

  const uniquePoolAddresses = [...new Set(rawPools.map((pool) => pool?.pool_address).filter(Boolean))];

  // Try volatility timeframes in order — fall back to longer ones if value is 0/missing
  const timeframesToTry = [...new Set([volatilityTimeframe, ...VOLATILITY_FALLBACK_TIMEFRAMES])];
  const metricsByPool = new Map();

  for (const tf of timeframesToTry) {
    if (tf === sourceTimeframe) continue;
    const remaining = uniquePoolAddresses.filter((addr) => {
      const existing = metricsByPool.get(addr);
      return !existing || existing.volatility == null || existing.volatility <= 0;
    });
    if (remaining.length === 0) break;

    const tfResults = await Promise.allSettled(
      remaining.map((poolAddress) =>
        fetchPoolDiscoveryDetail({ poolAddress, timeframe: tf })
          .then((pool) => ({
            poolAddress,
            volatility: numeric(pool?.volatility),
            volume: numeric(pool?.volume),
            timeframe: tf,
          }))
      )
    );

    for (const result of tfResults) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const cur = metricsByPool.get(result.value.poolAddress);
      // Only overwrite if existing is null/0 and this one has a usable value
      if (!cur || cur.volatility == null || cur.volatility <= 0) {
        if (result.value.volatility != null && result.value.volatility > 0) {
          metricsByPool.set(result.value.poolAddress, result.value);
        }
      }
    }
  }

  for (const pool of rawPools) {
    if (!pool?.pool_address) continue;
    const metrics = metricsByPool.get(pool.pool_address);
    if (!metrics) continue;

    pool[`volume_${metrics.timeframe}`] = metrics.volume;
    pool[`volatility_${metrics.timeframe}`] = metrics.volatility;

    // Use longer-timeframe values as the canonical ones for filtering
    if (metrics.volatility != null) pool.volatility = metrics.volatility;
    if (metrics.volume != null) pool.volume = metrics.volume;

    log("screening", `[volatility-debug] pool=${pool.name} tf=${metrics.timeframe} volatility=${metrics.volatility} usable=${isUsableVolatility(metrics.volatility)}`);
  }

  return rawPools;
}

async function searchAssetsBySymbol(symbol) {
  const res = await fetch(`${DATAPI_JUP}/assets/search?query=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`assets/search ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

async function enrichDiscordSignalLaunchpads(rawPools) {
  const missing = rawPools.filter((pool) =>
    pool?.discord_signal &&
    !getPoolLaunchpad(pool) &&
    getPoolBaseMint(pool)
  );
  if (missing.length === 0) return;

  const uniqueMints = [...new Set(missing.map(getPoolBaseMint).filter(Boolean))];
  const results = await Promise.allSettled(
    uniqueMints.map(async (mint) => {
      const assets = await searchAssetsBySymbol(mint);
      const asset = assets.find((item) => item?.id === mint) || assets[0] || null;
      return { mint, asset };
    })
  );

  const byMint = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const launchpad = result.value.asset?.launchpad || result.value.asset?.launchpadPlatform || null;
    if (!launchpad) continue;
    byMint.set(result.value.mint, {
      launchpad,
      dev: result.value.asset?.dev || null,
      holderCount: numeric(result.value.asset?.holderCount),
      organicScore: numeric(result.value.asset?.organicScore),
      marketCap: numeric(result.value.asset?.mcap ?? result.value.asset?.fdv),
      createdAt: result.value.asset?.createdAt ? Date.parse(result.value.asset.createdAt) : null,
    });
  }

  for (const pool of missing) {
    const mint = getPoolBaseMint(pool);
    const asset = byMint.get(mint);
    if (!asset) continue;
    pool.token_x ||= {};
    pool.token_x.launchpad = asset.launchpad;
    pool.base_token_launchpad = asset.launchpad;
    if (asset.dev && !pool.token_x.dev) pool.token_x.dev = asset.dev;
    if (asset.holderCount != null && pool.base_token_holders == null) pool.base_token_holders = asset.holderCount;
    if (asset.organicScore != null && pool.token_x.organic_score == null) pool.token_x.organic_score = asset.organicScore;
    if (asset.marketCap != null && pool.token_x.market_cap == null) pool.token_x.market_cap = asset.marketCap;
    if (asset.createdAt != null && pool.token_x.created_at == null) pool.token_x.created_at = asset.createdAt;
    log("screening", `Discord signal launchpad enriched from Jupiter: ${pool.name || mint} — ${asset.launchpad}`);
  }
}

async function findRivalPool(mint) {
  const minTvl = config.screening.pvpMinActiveTvl ?? 5000;
  const url = `https://dlmm.datapi.meteora.ag/pools?query=${encodeURIComponent(mint)}&sort_by=${encodeURIComponent("tvl:desc")}&filter_by=${encodeURIComponent(`tvl>${minTvl}`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rival pool search ${res.status}`);
  const data = await res.json();
  const pools = Array.isArray(data?.data) ? data.data : [];
  return pools.find((pool) => pool?.token_x?.address === mint || pool?.token_y?.address === mint) || null;
}

async function enrichPvpRisk(pools) {
  const shortlist = [...pools]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, PVP_SHORTLIST_LIMIT);

  if (shortlist.length === 0) return;

  const symbolCache = new Map();

  await Promise.all(shortlist.map(async (pool) => {
    const symbol = normalizeSymbol(pool.base?.symbol);
    const ownMint = pool.base?.mint;
    if (!symbol || !ownMint) return;

    let assets = symbolCache.get(symbol);
    if (!assets) {
      assets = await searchAssetsBySymbol(symbol).catch(() => []);
      symbolCache.set(symbol, assets);
    }

    const rivalAssets = assets
      .filter((asset) => normalizeSymbol(asset?.symbol) === symbol && asset?.id && asset.id !== ownMint)
      .sort((a, b) => Number(b?.liquidity || 0) - Number(a?.liquidity || 0))
      .slice(0, PVP_RIVAL_LIMIT);

    for (const rival of rivalAssets) {
      const rivalHolders = Number(rival?.holderCount || 0);
      const rivalFees = Number(rival?.fees || 0);
      const minHolders = config.screening.pvpMinHolders ?? 500;
      const minFees = config.screening.pvpMinGlobalFeesSol ?? 30;
      if (rivalHolders < minHolders || rivalFees < minFees) continue;

      const rivalPool = await findRivalPool(rival.id).catch(() => null);
      if (!rivalPool) continue;

      pool.is_pvp = true;
      pool.pvp_risk = "high";
      pool.pvp_symbol = pool.base?.symbol || symbol;
      pool.pvp_rival_name = rival?.name || pool.pvp_symbol;
      pool.pvp_rival_mint = rival.id;
      pool.pvp_rival_pool = rivalPool.address;
      pool.pvp_rival_tvl = round(Number(rivalPool.tvl || 0));
      pool.pvp_rival_holders = rivalHolders;
      pool.pvp_rival_fees = Number(rivalFees.toFixed(2));
      log("screening", `PVP guard: ${pool.name} has active rival ${pool.pvp_rival_name} (${rival.id.slice(0, 8)})`);
      break;
    }
  }));
}



/**
 * Fetch pools from the Meteora Pool Discovery API.
 * Returns condensed data optimized for LLM consumption (saves tokens).
 */

/**
 * Refresh live metrics for discord-only signal pools.
 * Their discovery_pool is a snapshot from when the signal was captured — volume/volatility/fee
 * can be 0 even if the pool is active right now. We overwrite with fresh data from the
 * pool discovery API so filtering uses current numbers, not stale ones.
 */
async function refreshDiscordOnlyPools(pools, timeframe) {
  if (!pools.length) return;
  const FIELDS = ["volume", "fee", "active_tvl", "tvl", "volatility", "fee_active_tvl_ratio"];
  const results = await Promise.allSettled(
    pools.map((pool) =>
      fetchPoolDiscoveryDetail({ poolAddress: pool.pool_address, timeframe })
        .then((fresh) => ({ pool, fresh }))
    )
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.fresh) continue;
    const { pool, fresh } = result.value;
    for (const field of FIELDS) {
      const val = numeric(fresh[field]);
      if (val != null) pool[field] = val;
    }
    log("screening", `Discord signal refreshed live data: ${pool.name || pool.pool_address} — vol=${pool.volume?.toFixed(0)} fee=${pool.fee?.toFixed(2)}`);
  }
}

export async function discoverPools({
  page_size = 50,
} = {}) {
  const s = config.screening;
  const filters = [
    "base_token_has_critical_warnings=false",
    "quote_token_has_critical_warnings=false",
    s.excludeHighSupplyConcentration ? "base_token_has_high_supply_concentration=false" : null,
    "base_token_has_high_single_ownership=false",
    "pool_type=dlmm",
    `base_token_holders>=${s.minHolders}`,
    `volume>=${s.minVolume}`,
    `tvl>=${s.minTvl}`,
    s.maxTvl != null ? `tvl<=${s.maxTvl}` : null,
    `dlmm_bin_step>=${s.minBinStep}`,
    `dlmm_bin_step<=${s.maxBinStep}`,
    `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${s.minOrganic}`,
    `quote_token_organic_score>=${s.minQuoteOrganic}`,
    s.minTokenAgeHours != null ? `base_token_created_at<=${Date.now() - s.minTokenAgeHours * 3_600_000}` : null,
    s.maxTokenAgeHours != null ? `base_token_created_at>=${Date.now() - s.maxTokenAgeHours * 3_600_000}` : null,
    Array.isArray(s.allowedLaunchpads) && s.allowedLaunchpads.length > 0
      ? `base_token_launchpad=[${s.allowedLaunchpads.join(",")}]`
      : null,
  ].filter(Boolean).join("&&");

  const data = await fetchPoolDiscoveryPage({
    page_size,
    filters,
    timeframe: s.timeframe,
    category: s.category,
    sortBy: s.discoverySortBy,
  });

  let rawPools = Array.isArray(data.data) ? data.data : [];

  if (config.screening.useDiscordSignals) {
    const signalCandidates = await fetchDiscordSignalCandidates().catch((error) => {
      log("screening", `Discord signal fetch failed: ${error.message}`);
      return [];
    });
    const signalPools = signalCandidates
      .map((candidate) => {
        const discoveryPool = candidate.discovery_pool;
        if (!discoveryPool?.pool_address) return null;
        return {
          ...discoveryPool,
          discord_signal: true,
          discord_signal_count: candidate.source_count || 1,
          discord_signal_seen_count: candidate.seen_count || 1,
          discord_signal_first_seen_at: candidate.first_seen_at || null,
          discord_signal_last_seen_at: candidate.last_seen_at || null,
        };
      })
      .filter(Boolean);

    if (config.screening.discordSignalMode === "only") {
      rawPools = signalPools;
      // Refresh all signal pools with live data since discovery_pool is a stale snapshot
      await refreshDiscordOnlyPools(rawPools, s.timeframe);
    } else if (signalPools.length > 0) {
      const byPool = new Map(rawPools.map((pool) => [pool.pool_address, pool]));
      const discordOnlyPools = [];
      for (const signalPool of signalPools) {
        if (byPool.has(signalPool.pool_address)) {
          byPool.set(signalPool.pool_address, {
            ...byPool.get(signalPool.pool_address),
            discord_signal: true,
            discord_signal_count: signalPool.discord_signal_count,
            discord_signal_seen_count: signalPool.discord_signal_seen_count,
            discord_signal_first_seen_at: signalPool.discord_signal_first_seen_at,
            discord_signal_last_seen_at: signalPool.discord_signal_last_seen_at,
          });
        } else {
          byPool.set(signalPool.pool_address, signalPool);
          discordOnlyPools.push(signalPool);
        }
      }
      rawPools = Array.from(byPool.values());
      // Refresh discord-only pools with live data — their discovery_pool is a stale snapshot
      // so volume/volatility/fee may be 0 even when the pool is active right now
      if (discordOnlyPools.length > 0) {
        await refreshDiscordOnlyPools(discordOnlyPools, s.timeframe);
      }
    }
  }

  rawPools = await applyVolatilityTimeframe(rawPools, s.timeframe);
  await enrichDiscordSignalLaunchpads(rawPools);

  const filteredExamples = [];
  const thresholdedRawPools = rawPools.filter((pool) => {
    const reason = getRawPoolScreeningRejectReason(pool, s);
    if (!reason) return true;
    filteredExamples.push({ name: pool.name || pool.pool_address || "unknown pool", reason });
    if (pool.discord_signal) log("screening", `Discord signal filtered: ${pool.name || pool.pool_address} — ${reason}`);
    return false;
  });

  const condensed = thresholdedRawPools.map(condensePool);

  // Hard-filter blacklisted tokens and blocked deployers (what pool discovery already gave us)
  let pools = condensed.filter((p) => {
    if (isBlacklisted(p.base?.mint)) {
      log("blacklist", `Filtered blacklisted token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)}) in pool ${p.name}`);
      return false;
    }
    if (p.dev && isDevBlocked(p.dev)) {
      log("dev_blocklist", `Filtered blocked deployer ${p.dev?.slice(0, 8)} token ${p.base?.symbol} in pool ${p.name}`);
      return false;
    }
    return true;
  });

  const filtered = condensed.length - pools.length;
  if (filtered > 0) log("blacklist", `Filtered ${filtered} pool(s) with blacklisted tokens/devs`);

  // If pool discovery didn't supply dev field, batch-fetch from Jupiter for any pools
  // where dev is null — but only if the dev blocklist is non-empty (avoid useless calls)
  const blockedDevs = getBlockedDevs();
  if (Object.keys(blockedDevs).length > 0) {
    const missingDev = pools.filter((p) => !p.dev && p.base?.mint);
    if (missingDev.length > 0) {
      const devResults = await Promise.allSettled(
        missingDev.map((p) =>
          fetch(`${DATAPI_JUP}/assets/search?query=${p.base.mint}`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              const t = Array.isArray(d) ? d[0] : d;
              return { pool: p.pool, dev: t?.dev || null };
            })
            .catch(() => ({ pool: p.pool, dev: null }))
        )
      );
      const devMap = {};
      for (const r of devResults) {
        if (r.status === "fulfilled") devMap[r.value.pool] = r.value.dev;
      }
      pools = pools.filter((p) => {
        const dev = devMap[p.pool];
        if (dev) p.dev = dev; // enrich in-place
        if (dev && isDevBlocked(dev)) {
          log("dev_blocklist", `Filtered blocked deployer (jup) ${dev.slice(0, 8)} token ${p.base?.symbol}`);
          return false;
        }
        return true;
      });
    }
  }

  return {
    total: data.total,
    pools,
    filtered_examples: filteredExamples,
  };
}

/**
 * Discover pools from Meteora Pool Discovery API.
 * Returns condensed pools (with all Meteora-specific fields).
 */
async function discoverFromMeteora() {
  try {
    const s = config.screening;
    const filters = [
      "pool_type=dlmm",
      `tvl>${s.minTvlDiscovery}`,
      `volume>${s.minVolumeDiscovery}`,
    ].filter(Boolean).join("&&");
    const data = await fetchPoolDiscoveryPage({
      page_size: 50,
      filters,
      timeframe: "24h",
      category: "all",
      sortBy: s.discoverySortBy,
    });
    const rawPools = Array.isArray(data.data) ? data.data : [];

    // Filter to pools with a known quote asset (SOL, USDC, USDT)
    const quotePools = rawPools.filter(p => {
      const tx = p.token_x?.address || "";
      const ty = p.token_y?.address || "";
      return isQuoteMint(tx) || isQuoteMint(ty);
    });

    if (rawPools.length === 0) {
      // Fallback: try without TVL/volume filters (still sorted)
      const fallback = await fetchPoolDiscoveryPage({
        page_size: 50,
        filters: "pool_type=dlmm",
        timeframe: "24h",
        category: "all",
        sortBy: s.discoverySortBy,
      });
      const fbRaw = Array.isArray(fallback.data) ? fallback.data : [];
      const fbQuote = fbRaw.filter(p => {
        const tx = p.token_x?.address || "";
        const ty = p.token_y?.address || "";
        return isQuoteMint(tx) || isQuoteMint(ty);
      });
      fbQuote.forEach(p => rawPools.push(p));
      fbQuote.forEach(p => quotePools.push(p));
    }

    // Filter out dead pools, sort by volume descending, take top 100
    const pools = quotePools
      .filter(p => {
        const tvl = Number(p.tvl || p.active_tvl || 0);
        const vol = Number(p.volume || 0);
        return tvl > 0 && vol > 0;
      })
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 100)
      .map(p => {
        const tx = p.token_x?.address || "";
        const ty = p.token_y?.address || "";
        const isQuoteOnX = isQuoteMint(tx);
        const isQuoteOnY = isQuoteMint(ty);
        const quoteAddress = isQuoteOnX ? tx : (isQuoteOnY ? ty : tx);
        const quoteSymbol = getQuoteSymbol(quoteAddress) || (isQuoteOnX ? p.token_x?.symbol : p.token_y?.symbol) || "?";
        const base = isQuoteOnX ? p.token_y : p.token_x;
        const baseSymbol = base?.symbol || (base?.address || "").slice(0, 4);
        const feeTvl = resolveFeeTvlRatio(p, s.timeframe || "1h");
        log("screening", `[fee-tvl-debug] pool=${baseSymbol}-${quoteSymbol} raw_fee_tvl=${JSON.stringify(p.fee_active_tvl_ratio ?? p.fee_tvl_ratio)} used=${feeTvl} vs min=${s.minFeeActiveTvlRatio}`);
        return {
          pool: p.pool_address,
          name: `${baseSymbol}-${quoteSymbol}`,
          base: { symbol: baseSymbol, mint: base?.address, organic: Math.round(base?.organic_score || 0), warnings: base?.warnings?.length || 0 },
          quote: { symbol: quoteSymbol, mint: quoteAddress },
          pool_type: "dlmm",
          bin_step: Number(p.dlmm_params?.bin_step) || null,
          fee_pct: Number(p.fee_pct) || null,
          tvl: Math.round(Number(p.tvl || p.active_tvl || 0)),
          active_tvl: Math.round(Number(p.active_tvl || p.tvl || 0)),
          fee_window: null,
          volume_window: Math.round(Number(p.volume || 0)),
          fee_active_tvl_ratio: feeTvl,
          volatility: Number(p.volatility) || null,
          volatility_timeframe: "30m",
          holders: Number(base?.holders ?? p.base_token_holders ?? 0),
          mcap: Math.round(Number(base?.market_cap || 0)),
          token_age_hours: base?.created_at ? Math.floor((Date.now() - base.created_at) / 3_600_000) : null,
          dev: base?.dev || null,
          launchpad: base?.launchpad || null,
          price: Number(p.pool_price) || null,
          price_change_pct: Number(p.pool_price_change_pct) || null,
          dex_source: false,
          meteora_found: true,
          verified_dlmm: true,
        };
      });

    log("discovery", `source=meteora_dlmm count=${pools.length} (real DLMM pools)`);
    return { pools, source: "meteora" };
  } catch (err) {
    log("discovery", `source=meteora_dlmm error=${err.message}`);
    return { pools: [], source: "meteora" };
  }
}

/**
 * Discover pools from GMGN API.
 * Requires GMGN_API_KEY to be configured.
 */
async function discoverFromGMGN() {
  try {
    const { discoverGmgnPools } = await import("./gmgn.js");
    const result = await discoverGmgnPools({ limit: Math.max(50, config.gmgn?.enrichLimit || 20) });
    const pools = Array.isArray(result?.pools) ? result.pools : [];
    log("discovery", `source=gmgn count=${pools.length}`);
    return { pools, source: "gmgn" };
  } catch (err) {
    const e = err.message?.toLowerCase() || '';
    const category = e.includes('api key') || e.includes('invalid key') || e.includes('401') ? 'discovery_debug' : 'discovery';
    log(category, `source=gmgn error=${err.message}`);
    return { pools: [], source: "gmgn" };
  }
}

/**
 * Normalize a DexScreener pair into the pool format expected by screening.
 */
function condenseDexPair(pair) {
  return {
    pool: pair.pairAddress || `dex-${pair.baseToken?.address}-${pair.quoteToken?.address}`,
    name: `${pair.baseToken?.symbol || "?"}-${pair.quoteToken?.symbol || "?"}`,
    base: {
      symbol: pair.baseToken?.symbol,
      mint: pair.baseToken?.address,
      organic: null,
      warnings: 0,
    },
    quote: {
      symbol: pair.quoteToken?.symbol,
      mint: pair.quoteToken?.address,
    },
    pool_type: null,
    bin_step: null,
    fee_pct: null,
    tvl: round(pair.liquidity?.usd ?? 0),
    active_tvl: round(pair.liquidity?.usd ?? 0),
    fee_window: null,
    volume_window: round(pair.volume?.h24 ?? 0),
    fee_active_tvl_ratio: null,
    volatility: null,
    holders: null,
    mcap: round(pair.marketCap ?? pair.fdv ?? 0),
    token_age_hours: pair.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / 3_600_000) : null,
    dev: null,
    launchpad: null,
    price: pair.priceUsd ? Number(pair.priceUsd) : null,
    price_change_pct: null,
    dex_source: true,
    dex_volume_h24: round(pair.volume?.h24 ?? 0),
    dex_liquidity: round(pair.liquidity?.usd ?? 0),
  };
}

/**
 * Discover trending pools from DexScreener token-boosts/top/v1.
 */
async function discoverFromDexScreenerTrending() {
  try {
    const res = await fetch("https://api.dexscreener.com/token-boosts/top/v1");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const boosts = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const solanaBoosts = boosts.filter(b => (b.chainId ?? "") === "solana");
    const pools = [];
    for (const boost of solanaBoosts.slice(0, 30)) {
      try {
        const searchRes = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${boost.tokenAddress}`, { signal: AbortSignal.timeout(5000) });
        if (!searchRes.ok) continue;
        const searchData = await searchRes.json();
        const pairs = Array.isArray(searchData?.pairs) ? searchData.pairs : [];
        const solPairs = pairs.filter(p => p.chainId === "solana");
        for (const pair of solPairs.slice(0, 3)) {
          pools.push(condenseDexPair(pair));
        }
      } catch { /* skip failed token */ }
    }
    log("discovery", `source=dexscreener_trending count=${pools.length}`);
    return { pools, source: "dexscreener_trending" };
  } catch (err) {
    log("discovery", `source=dexscreener_trending error=${err.message}`);
    return { pools: [], source: "dexscreener_trending" };
  }
}

/**
 * Discover boosted pools from DexScreener token-boosts/latest/v1.
 */
async function discoverFromDexScreenerBoosted() {
  try {
    const res = await fetch("https://api.dexscreener.com/token-boosts/latest/v1");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const boosts = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const solanaBoosts = boosts.filter(b => (b.chainId ?? "") === "solana");
    const pools = [];
    for (const boost of solanaBoosts.slice(0, 30)) {
      try {
        const searchRes = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${boost.tokenAddress}`, { signal: AbortSignal.timeout(5000) });
        if (!searchRes.ok) continue;
        const searchData = await searchRes.json();
        const pairs = Array.isArray(searchData?.pairs) ? searchData.pairs : [];
        const solPairs = pairs.filter(p => p.chainId === "solana");
        for (const pair of solPairs.slice(0, 3)) {
          pools.push(condenseDexPair(pair));
        }
      } catch { /* skip failed token */ }
    }
    log("discovery", `source=dexscreener_boosted count=${pools.length}`);
    return { pools, source: "dexscreener_boosted" };
  } catch (err) {
    log("discovery", `source=dexscreener_boosted error=${err.message}`);
    return { pools: [], source: "dexscreener_boosted" };
  }
}

/**
 * Discover concentrated liquidity pools from Raydium (CLMM).
 * Filters for SOL pairs only. These are NOT Meteora DLMM pools.
 */
async function discoverFromRaydium() {
  try {
    const res = await fetch(
      "https://api-v3.raydium.io/pools/info/list?poolType=concentrated&sort=volume24h&order=desc&pageSize=50&page=1",
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = data?.data?.pools ?? [];
    const SOL = "So11111111111111111111111111111111111111112";
    const pools = raw
      .filter(p => p.mintA?.address === SOL || p.mintB?.address === SOL)
      .map(p => ({
        pool: p.poolId || `ray-${p.mintA?.address}-${p.mintB?.address}`,
        name: `${p.mintA?.symbol || "?"}-${p.mintB?.symbol || "?"}`,
        base: {
          symbol: p.mintA?.address === SOL ? p.mintB?.symbol : p.mintA?.symbol,
          mint: p.mintA?.address === SOL ? p.mintB?.address : p.mintA?.address,
          organic: null,
          warnings: 0,
        },
        quote: {
          symbol: p.mintA?.address === SOL ? p.mintA?.symbol : p.mintB?.symbol,
          mint: SOL,
        },
        pool_type: 'concentrated',
        bin_step: null,
        fee_pct: p.day?.feeApr ?? null,
        tvl: p.tvl ?? 0,
        active_tvl: p.tvl ?? 0,
        volume_window: p.day?.volume ?? 0,
        fee_active_tvl_ratio: null,
        volatility: null,
        holders: null,
        mcap: null,
        price: null,
        dex_source: 'raydium',
        dex_volume_h24: p.day?.volume ?? 0,
        dex_liquidity: p.tvl ?? 0,
      }));
    log("discovery", `source=raydium_clmm count=${pools.length}`);
    return { pools, source: "raydium_clmm" };
  } catch (err) {
    log("discovery", `source=raydium_clmm error=${err.message}`);
    return { pools: [], source: "raydium_clmm" };
  }
}

/**
 * Discover whirlpools from Orca.
 * Filters for SOL pairs only. These are NOT Meteora DLMM pools.
 */
async function discoverFromOrca() {
  try {
    const res = await fetch(
      "https://api.mainnet.orca.so/v1/whirlpool/list",
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = data?.whirlpools ?? [];
    const SOL = "So11111111111111111111111111111111111111112";
    const filtered = raw
      .filter(p => p.tokenA?.mint === SOL || p.tokenB?.mint === SOL);
    const totalBefore = filtered.length;
    // Limit to top 50 by daily volume (SOL-side only)
    const sorted = filtered
      .filter(p => (p.volume?.day ?? 0) > 0)
      .sort((a, b) => (b.volume?.day ?? 0) - (a.volume?.day ?? 0))
      .slice(0, 50);
    console.log(`[orca-debug] before filter: ${totalBefore} SOL-pairs, after volume filter+sort: ${sorted.length}${totalBefore > 50 ? ` (limited from ${totalBefore})` : ''}`);
    const pools = sorted
      .map(p => ({
        pool: p.address || `orca-${p.tokenA?.mint}-${p.tokenB?.mint}`,
        name: `${p.tokenA?.symbol || "?"}-${p.tokenB?.symbol || "?"}`,
        base: {
          symbol: p.tokenA?.mint === SOL ? p.tokenB?.symbol : p.tokenA?.symbol,
          mint: p.tokenA?.mint === SOL ? p.tokenB?.mint : p.tokenA?.mint,
          organic: null,
          warnings: 0,
        },
        quote: {
          symbol: p.tokenA?.mint === SOL ? p.tokenA?.symbol : p.tokenB?.symbol,
          mint: SOL,
        },
        pool_type: 'whirlpool',
        bin_step: p.tickSpacing ?? null,
        fee_pct: p.feeApr ?? null,
        tvl: p.tvl ?? 0,
        active_tvl: p.tvl ?? 0,
        volume_window: p.volume?.day ?? 0,
        fee_active_tvl_ratio: null,
        volatility: null,
        holders: null,
        mcap: null,
        price: null,
        dex_source: 'orca',
        dex_volume_h24: p.volume?.day ?? 0,
        dex_liquidity: p.tvl ?? 0,
      }));
    log("discovery", `source=orca_whirlpools count=${pools.length}`);
    return { pools, source: "orca_whirlpools" };
  } catch (err) {
    log("discovery", `source=orca_whirlpools error=${err.message}`);
    return { pools: [], source: "orca_whirlpools" };
  }
}

/**
 * Discover trending pools from HawkFi smart LP data.
 */
async function discoverFromHawkFi() {
  try {
    const { HawkFiAdapter } = await import("../dist/integrations/hawkfi/hawkfiAdapter.js");
    const hawkfi = new HawkFiAdapter();
    const pools = await hawkfi.getTrendingPools();
    log("discovery", `source=hawkfi count=${pools.length}`);
    return { pools: pools.map(p => ({
      pool: p.poolAddress,
      name: p.name,
      base: { symbol: null, mint: p.baseMint, organic: null, warnings: 0 },
      quote: { symbol: "SOL", mint: p.quoteMint },
      pool_type: null,
      bin_step: null,
      fee_pct: null,
      tvl: p.tvl,
      active_tvl: p.tvl,
      volume_window: p.volume24h,
      fee_active_tvl_ratio: null,
      volatility: null,
      holders: null,
      mcap: null,
      price: null,
      dex_source: 'hawkfi',
      hawkfi_smart_wallets: p.smartWalletCount,
    })), source: "hawkfi" };
  } catch (err) {
    log("discovery", `source=hawkfi error=${err.message}`);
    return { pools: [], source: "hawkfi" };
  }
}

/**
 * Run all discovery sources in parallel, merge by mint, deduplicate.
 * Priority order for duplicate mints: meteora > gmgn > dexscreener_trending > dexscreener_boosted > raydium > orca > hawkfi
 */
async function discoverAll() {
  const s = config.screening;
  const allDisabled = !s.enableDexscreener && !s.enableOrca && !s.enableRaydium && !s.enableHawkfi && !s.enableGmgn;
  if (allDisabled) {
    log("discovery", "[DISCOVERY] Meteora-only mode (other sources disabled)");
  }

  const sources = await Promise.allSettled([
    discoverFromMeteora(),
    s.enableGmgn ? discoverFromGMGN() : Promise.resolve({ pools: [], source: "gmgn" }),
    s.enableDexscreener ? discoverFromDexScreenerTrending() : Promise.resolve({ pools: [], source: "dexscreener_trending" }),
    s.enableDexscreener ? discoverFromDexScreenerBoosted() : Promise.resolve({ pools: [], source: "dexscreener_boosted" }),
    s.enableRaydium ? discoverFromRaydium() : Promise.resolve({ pools: [], source: "raydium" }),
    s.enableOrca ? discoverFromOrca() : Promise.resolve({ pools: [], source: "orca" }),
    s.enableHawkfi ? discoverFromHawkFi() : Promise.resolve({ pools: [], source: "hawkfi" }),
  ]);

  const allPools = [];
  for (const result of sources) {
    if (result.status === "fulfilled") {
      for (const pool of result.value.pools) {
        allPools.push(pool);
      }
    }
  }

  // Merge by mint — keep first occurrence (priority: meteora > gmgn > dexscreener_trending > dexscreener_boosted)
  const seen = new Set();
  const merged = [];
  for (const pool of allPools) {
    const mint = pool.base?.mint;
    if (!mint || seen.has(mint)) continue;
    seen.add(mint);
    merged.push(pool);
  }

  log("discovery", `merged count=${merged.length} (raw=${allPools.length})`);
  return merged;
}

/**
 * Enrich candidate pools with Birdeye, Jupiter, and DexScreener data.
 * Merges by mint, deduplicates, and applies enrichment-based filters.
 */
async function enrichCandidates(pools, s) {
  if (!Array.isArray(pools) || pools.length === 0) return { pools: [], filtered: [] };
  const { integrations } = await import("../dist/integrations/index.js");
  const birdeye = integrations.birdeye;
  const jupiter = integrations.jupiter;
  const dexscreener = integrations.dexscreener;

  const uniqueMints = [...new Set(pools.map(p => p.base?.mint).filter(Boolean))];
  const enrichedMints = new Map();

  // Build mint → pool address map for volume history lookup
  const mintToPool = new Map();
  for (const p of pools) {
    const mint = p.base?.mint;
    if (mint && !mintToPool.has(mint)) mintToPool.set(mint, p.pool);
  }

  for (const mint of uniqueMints) {
    const overlay = {};
    const rateLimits = { birdeye: false, jupiter: false };

    const wrapBirdeye = (p) => p.catch((err) => {
      if (err?.message?.includes('429') || err?.message?.includes('401')) rateLimits.birdeye = true;
      return null;
    });
    const wrapJupiter = (p) => p.catch((err) => {
      if (err?.message?.includes('429') || err?.message?.includes('401')) rateLimits.jupiter = true;
      return null;
    });

    const [birdeyeResult, jupiterResult, dexResult, verifyResult] = await Promise.allSettled([
      wrapBirdeye(birdeye.getTokenOverview(mint)),
      wrapJupiter(jupiter.getTokenInfo(mint)),
      dexscreener.searchPairs(mint).catch(() => ({ pairs: [] })),
      searchAssetsBySymbol(mint).catch(() => null),
    ]);

    if (birdeyeResult.status === 'fulfilled' && birdeyeResult.value) {
      const b = birdeyeResult.value;
      overlay.birdeyeHolders = b.holders;
      overlay.birdeyeLiquidity = b.liquidity;
      overlay.birdeyeMarketCap = b.marketCap;
      overlay.birdeyeVolume24h = b.volume24h;
    }

    if (jupiterResult.status === 'fulfilled' && jupiterResult.value) {
      const j = jupiterResult.value;
      const jt = j.results?.[0] || null;
      if (jt) {
        overlay.jupiterHolders = jt.holders;
        overlay.jupiterMarketCap = jt.marketCap;
        overlay.jupiterLiquidity = jt.liquidity;
        overlay.jupiterVolume24h = jt.volume24h;
        overlay.botHoldersPct = jt.audit?.bot_holders_pct != null ? jt.audit.bot_holders_pct : overlay.botHoldersPct;
        overlay.topHoldersPct = jt.audit?.top_holders_pct != null ? jt.audit.top_holders_pct : overlay.topHoldersPct;
      }
    }

    if (dexResult.status === 'fulfilled') {
      const pairs = dexResult.value?.pairs ?? [];
      const solPairs = pairs.filter(p => p.chainId === 'solana');
      if (solPairs.length > 0) {
        const bestLiquidity = solPairs.reduce((max, p) => Math.max(max, p.liquidity?.usd ?? 0), 0);
        const bestVolume24h = solPairs.reduce((max, p) => Math.max(max, p.volume?.h24 ?? 0), 0);
        overlay.dexLiquidity = bestLiquidity;
        overlay.dexVolume24h = bestVolume24h;
      }
    }

    // Verify token: fetch verified status and JupShield presence from Jupiter DatAPI
    if (verifyResult.status === 'fulfilled' && verifyResult.value) {
      const assets = Array.isArray(verifyResult.value) ? verifyResult.value : [verifyResult.value];
      const v = assets.find((item) => item?.id === mint) || null;
      if (v) {
        overlay.jupVerified = v.isVerified === true || (Array.isArray(v.tags) && v.tags.includes('verified'));
        overlay.jupShielded = Array.isArray(v.tags) && (v.tags.includes('shield') || v.tags.includes('jup_shield'));
      }
    }

    // Fetch fee_tvl from DLMM datapi as fallback when pool discovery API returned null
    const feePoolAddr = mintToPool.get(mint);
    if (feePoolAddr && overlay.feeActiveTvlRatio == null) {
      try {
        const dlmmRes = await fetch(`${METEORA_DLMM_API}/pools/${feePoolAddr}`);
        if (dlmmRes.ok) {
          const dlmmPool = await dlmmRes.json();
          const rawFeeTvl = dlmmPool?.fee_tvl_ratio ?? dlmmPool?.fee_active_tvl_ratio;
          if (rawFeeTvl != null) {
            const resolved = typeof rawFeeTvl === "number" ? rawFeeTvl
              : typeof rawFeeTvl === "string" ? Number(rawFeeTvl)
              : typeof rawFeeTvl === "object" && !Array.isArray(rawFeeTvl)
                ? (rawFeeTvl[s.timeframe || "1h"] ?? rawFeeTvl["1h"] ?? rawFeeTvl["30m"] ?? null)
              : null;
            if (resolved != null && Number.isFinite(resolved)) {
              overlay.feeActiveTvlRatio = Number(resolved);
              log("enrichment", `[fee-tvl] mint=${mint} pool=${feePoolAddr.slice(0,8)} dlmm_raw=${JSON.stringify(rawFeeTvl)} resolved=${overlay.feeActiveTvlRatio}`);
            }
          }
        }
      } catch {}
    }

    // Jupiter DatAPI holder count fallback when best available data is missing or suspiciously low
    const bestKnownHolders = overlay.birdeyeHolders || overlay.jupiterHolders || 0;
    if (!bestKnownHolders || bestKnownHolders < 100) {
      try {
        const res = await fetch(`${DATAPI_JUP}/holders/${mint}?limit=1`);
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray(data) ? data : (data?.holders ?? []);
          const realTotal = data?.count ?? items.length;
          if (Number(realTotal) > 0) {
            overlay.jupiterHolders = Number(realTotal);
          }
          console.log(`[enrich-holders] ${mint} realTotal=${data?.count ?? '?'} sampled=${items.length} using=${overlay.jupiterHolders || '?'}`);
        }
      } catch {}
    }

    // Calculate botPct/top10Pct from holder data when Jupiter audit is unavailable
    if (overlay.botHoldersPct == null || overlay.topHoldersPct == null) {
      try {
        // DEBUG: log before fetch
        const holderUrl = `${DATAPI_JUP}/holders/${mint}?limit=100`;
        console.log(`[enrich-debug] ${mint} fetching holders from: ${holderUrl}`);
        const holderRes = await fetch(holderUrl);
        if (holderRes.ok) {
          const holderData = await holderRes.json();
          const holders = Array.isArray(holderData) ? holderData : (holderData?.holders ?? []);
          const holderRealTotal = holderData?.count ?? holders.length;
          console.log(`[enrich-debug] ${mint} holders count: ${holders?.length ?? 0} realTotal: ${holderRealTotal}`);
          if (holders.length > 0) {
            // Debug: log first holder to see actual field names
            console.log('[holder-sample]', JSON.stringify(holders[0]));

            // Jupiter DatAPI returns amount (raw lamports/ui_amount) — no percentage field
            // Calculate percentages from raw amounts
            const totalAmount = holders.reduce((sum, h) => sum + Number(h.amount ?? h.ui_amount ?? h.balance ?? 0), 0);
            console.log('[bot-calc]', mint, 'totalAmount:', totalAmount, 'holderCount:', holders.length);

            const withPct = holders.map(h => {
              const amt = Number(h.amount ?? h.ui_amount ?? h.balance ?? 0);
              return {
                address: String(h.address ?? ''),
                amount: amt,
                pct: totalAmount > 0 ? (amt / totalAmount) * 100 : 0,
              };
            });

            // Top 10 holders percentage
            const sorted = [...withPct].sort((a, b) => b.pct - a.pct);
            const top10Sum = sorted.slice(0, 10).reduce((s, h) => s + h.pct, 0);
            overlay.topHoldersPct = Math.round(top10Sum * 100) / 100;

            // Bot estimate: holders with < 0.05% share (very small wallets) or identical amounts
            const amountCounts = {};
            withPct.forEach(h => { amountCounts[h.amount] = (amountCounts[h.amount] || 0) + 1; });
            const duplicateAmounts = new Set(
              Object.entries(amountCounts).filter(([, c]) => c > 2).map(([a]) => Number(a))
            );
            const potentialBots = withPct.filter(h => h.pct < 0.05 || duplicateAmounts.has(h.amount));
            overlay.botHoldersPct = Math.round((potentialBots.length / withPct.length) * 100);

            console.log('[bot-calc]', mint, 'top1 holder pct:', sorted[0]?.pct, 'top10:', top10Sum, 'bots:', overlay.botHoldersPct);
            log("enrichment", `mint=${mint} botPct CALCULATED from holders: top10=${overlay.topHoldersPct}% bots=${overlay.botHoldersPct}% (${potentialBots.length}/${withPct.length} wallets)`);
          }
        }
      } catch { /* holder calc failed — enrichment will show ? */ }
    }

    // Confidence scoring based on which enrichment sources provided data
    overlay.holdersConfidence = overlay.birdeyeHolders != null && overlay.birdeyeHolders > 0 ? 'HIGH'
      : overlay.jupiterHolders != null && overlay.jupiterHolders > 0 ? 'MEDIUM'
      : rateLimits.birdeye ? 'RATE_LIMITED'
      : 'NONE';
    overlay.marketCapConfidence = overlay.birdeyeMarketCap != null ? 'HIGH'
      : overlay.jupiterMarketCap != null ? 'MEDIUM'
      : rateLimits.birdeye ? 'RATE_LIMITED'
      : 'NONE';
    overlay.auditConfidence = (overlay.botHoldersPct != null || overlay.topHoldersPct != null) ? 'HIGH'
      : rateLimits.jupiter ? 'RATE_LIMITED'
      : 'NONE';

    // Composite quality score
    const mcap = overlay.birdeyeMarketCap || overlay.jupiterMarketCap || 0;
    const liq = overlay.birdeyeLiquidity || overlay.jupiterLiquidity || overlay.dexLiquidity || 0;
    const vol = overlay.birdeyeVolume24h || overlay.jupiterVolume24h || overlay.dexVolume24h || 0;
    const numericMcap = Number(mcap) || 0;
    const numericLiq = Number(liq) || 0;
    const numericVol = Number(vol) || 0;
    const mcapScore = Math.min(1, numericMcap / 10_000_000);
    const liqScore = Math.min(1, numericLiq / 500_000);
    const volScore = Math.min(1, numericVol / 500_000);

    const mcapAvailable = numericMcap > 0;
    let qualityScore;
    if (mcapAvailable) {
      // Full formula: mcap ×2, liq ×1.5, vol ×1.5 (max total = 5)
      qualityScore = mcapScore * 2 + liqScore * 1.5 + volScore * 1.5;
    } else {
      // No mcap: renormalize liq and vol to same max (redistribute mcap weight)
      qualityScore = liqScore * 2.5 + volScore * 2.5;
    }

    // Penalty for missing confidence (RATE_LIMITED and NONE both get penalty)
    if (overlay.holdersConfidence === 'NONE' || overlay.holdersConfidence === 'RATE_LIMITED' ||
        overlay.marketCapConfidence === 'NONE' || overlay.marketCapConfidence === 'RATE_LIMITED') {
      qualityScore *= 0.85;
    }

    overlay.qualityScore = Math.round(qualityScore * 100) / 100;

    const mcapSource = overlay.birdeyeMarketCap != null ? 'BIRDEYE' : overlay.jupiterMarketCap != null ? 'JUPITER' : 'NONE';
    log("enrichment", `mint=${mint} holders=${overlay.birdeyeHolders || overlay.jupiterHolders || '?'} botPct=${overlay.botHoldersPct ?? '?'} top10Pct=${overlay.topHoldersPct ?? '?'} liquidity=${overlay.birdeyeLiquidity || overlay.jupiterLiquidity || overlay.dexLiquidity || '?'} volume=${overlay.birdeyeVolume24h || overlay.jupiterVolume24h || overlay.dexVolume24h || '?'}`);
    log("enrichment", `[QUALITY] mint=${mint} score=${overlay.qualityScore} holdersConf=${overlay.holdersConfidence} mcapConf=${overlay.marketCapConfidence} mcapSource=${mcapSource} auditConf=${overlay.auditConfidence} holders=${overlay.birdeyeHolders || overlay.jupiterHolders || '?'} mcap=${overlay.birdeyeMarketCap || overlay.jupiterMarketCap || '?'} liq=${liq}`);

    // Volume trend from Meteora DatAPI /volume/history (additive enrichment, graceful fallback)
    const poolAddr = mintToPool.get(mint);
    if (poolAddr) {
      const volHistory = await fetchPoolVolumeHistory(poolAddr);
      const volTrend = computeVolumeAcceleration(volHistory);
      if (volTrend) {
        overlay.volumeTrend = volTrend.trend;
        overlay.volumeAccelRatio = volTrend.ratio;
        overlay.volumeRecentAvg = volTrend.recentAvg;
        overlay.volumePriorAvg = volTrend.priorAvg;
        log("enrichment", `[volume-trend] mint=${mint} pool=${poolAddr.slice(0, 8)} trend=${volTrend.trend} ratio=${volTrend.ratio}x recentAvg=${volTrend.recentAvg} priorAvg=${volTrend.priorAvg}`);
      }
    }

    enrichedMints.set(mint, overlay);
  }

  const enriched = [];
  const filtered = [];
  for (const pool of pools) {
    const mint = pool.base?.mint;
    const enr = mint ? enrichedMints.get(mint) : null;

    let rejected = false;
    if (enr) {
      if (enr.botHoldersPct != null && enr.botHoldersPct > s.maxBotHoldersPct) {
        filtered.push({ name: pool.name, reason: `botHoldersPct ${enr.botHoldersPct}% above maxBotHoldersPct ${s.maxBotHoldersPct}%` });
        rejected = true;
      }
      if (!rejected && enr.topHoldersPct != null && enr.topHoldersPct > s.maxTop10Pct) {
        filtered.push({ name: pool.name, reason: `topHoldersPct ${enr.topHoldersPct}% above maxTop10Pct ${s.maxTop10Pct}%` });
        rejected = true;
      }
    }

    if (rejected) continue;

    pool._enrichment = enr;
    enriched.push(pool);
  }

  return { pools: enriched, filtered };
}

/**
 * Returns eligible pools for the agent to evaluate and pick from.
 * Hard filters applied in code, agent decides which to deploy into.
 */
export async function getTopCandidates({ limit = 10 } = {}) {
  const { config } = await import("../config.js");

  // Multi-source discovery: run all sources in parallel, merge by mint, deduplicate
  const allPools = await discoverAll();
  let pools = [...allPools];

  // Apply volatility timeframe adjustment (1h/12h/24h fallback) so pools aren't rejected with 0 volatility
  pools = await applyVolatilityTimeframe(pools, config.screening.timeframe);
  const filteredOut = [];

  log("discovery", `raw candidates per source (see individual [DISCOVERY] lines above)`);
  log("discovery", `merged candidates=${allPools.length} deduplicated=${allPools.length} (duplicates already removed in merge)`);

  // Exclude pools where the wallet already has an open position
  const { getMyPositions } = await import("./dlmm.js");
  const { positions } = await getMyPositions();
  const occupiedPools = new Set(positions.map((p) => p.pool));
  const occupiedMints = new Set(positions.map((p) => p.base_mint).filter(Boolean));
  log("screening", `[dedup-mint] occupied mints: ${[...occupiedMints].join(", ") || "(none)"}`);
  // In DRY RUN, also exclude pools with open dry-run positions (getMyPositions returns 0 on-chain)
  if (process.env.DRY_RUN === "true") {
    try {
      const { getDryRunPositions } = await import("./dryRunPositions.js");
      const dryOpen = getDryRunPositions();
      for (const p of dryOpen) {
        if (p.pool_address) occupiedPools.add(p.pool_address);
        if (p.base_mint) {
          occupiedMints.add(p.base_mint);
          log("screening", `[dedup-mint] dry-run position adds mint ${p.base_mint}`);
        }
      }
    } catch (e) { /* non-critical */ }
  }
  const minTvl = Number(config.screening.minTvl ?? 0);
  const maxTvl = config.screening.maxTvl == null ? null : Number(config.screening.maxTvl);
  const minFeeActiveTvlRatio = Number(config.screening.minFeeActiveTvlRatio ?? 0);

  const eligible = pools
    .filter((p) => {
      const tvl = Number(p.tvl ?? p.active_tvl ?? 0);
      if (Number.isFinite(minTvl) && minTvl > 0 && tvl < minTvl) {
        pushFilteredReason(filteredOut, p, `TVL $${tvl} below minTvl $${minTvl}`);
        return false;
      }
      if (Number.isFinite(maxTvl) && maxTvl > 0 && tvl > maxTvl) {
        pushFilteredReason(filteredOut, p, `TVL $${tvl} above maxTvl $${maxTvl}`);
        return false;
      }
      // DexScreener sources don't provide fee/active-TVL or volatility — skip those checks
      if (!p.dex_source) {
        const feeActiveTvlRatio = p.fee_active_tvl_ratio;
        if (feeActiveTvlRatio != null && Number.isFinite(minFeeActiveTvlRatio) && minFeeActiveTvlRatio > 0 && feeActiveTvlRatio < minFeeActiveTvlRatio) {
          pushFilteredReason(filteredOut, p, `fee/active-TVL ${feeActiveTvlRatio}% below minFeeActiveTvlRatio ${minFeeActiveTvlRatio}%`);
          return false;
        }
        if (!isUsableVolatility(p.volatility)) {
          log("screening", `[volatility-debug] pool=${p.name} volatility=${p.volatility} tf=${p.volatility_timeframe || "?"} usable=false — rejected`);
          pushFilteredReason(filteredOut, p, `volatility ${p.volatility ?? "unknown"} unusable`);
          return false;
        }
        const maxVol = config.screening.maxVolatility;
        if (maxVol != null && maxVol > 0 && numeric(p.volatility) > maxVol) {
          log("screening", `[volatility-debug] pool=${p.name} volatility=${numeric(p.volatility)} tf=${p.volatility_timeframe || "?"} maxVol=${maxVol} ceilingExceeded=true — API scale may be 0-1000 vs config 0-5`);
          pushFilteredReason(filteredOut, p, `volatility ${numeric(p.volatility)} exceeds ceiling ${maxVol} — IL risk too high`);
          return false;
        }
      }
      if (occupiedPools.has(p.pool)) {
        pushFilteredReason(filteredOut, p, "already have an open position in this pool");
        return false;
      }
      const candidateMint = p.base?.mint ?? p.base_mint ?? p.token_x?.address;
      if (candidateMint && occupiedMints.has(candidateMint)) {
        log("screening", `[dedup-mint] skipping ${p.name} mint=${candidateMint} — already holding this token`);
        pushFilteredReason(filteredOut, p, "already holding this base token in another pool");
        return false;
      }
      if (isPoolOnCooldown(p.pool)) {
        log("screening", `Filtered cooldown pool ${p.name} (${p.pool.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "pool cooldown active");
        return false;
      }
      if (isBaseMintOnCooldown(p.base?.mint)) {
        log("screening", `Filtered cooldown token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "token cooldown active");
        return false;
      }
      return true;
    })
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, limit);

  // Phase 89c — Verify DexScreener pools are actually Meteora DLMM pools
  // DexScreener returns regular AMM pools; get_active_bin fails on non-DLMM pools
  // Raydium and Orca pools are also non-DLMM — skip verification for them too
  if (eligible.length > 0) {
    const dlmmValid = [];
    for (const pool of eligible) {
      if (pool.dex_source !== true) {
        dlmmValid.push(pool);
        continue;
      }
      const mint = pool.base?.mint;
      if (!mint) {
        pushFilteredReason(filteredOut, pool, "no base mint");
        continue;
      }
      const meteoraPool = await findMeteoraDlmmPool(mint);
      if (meteoraPool) {
        pool.pool = meteoraPool.pool_address;
        pool.meteora_found = true;
        dlmmValid.push(pool);
      } else {
        pushFilteredReason(filteredOut, pool, "no Meteora DLMM pool found");
        log("screening", `[SCREENING] skipped ${pool.name} — no Meteora DLMM pool found`);
      }
    }
    eligible.splice(0, eligible.length, ...dlmmValid);
  }

  // Multi-source enrichment: cross-reference Birdeye, Jupiter, DexScreener
  // Enrich only top 5 pools for speed — un-enriched pools still pass with pool-direct fields
  const ENRICH_LIMIT = 5;
  if (eligible.length > 0) {
    const topPools = eligible.slice(0, ENRICH_LIMIT);
    const restPools = eligible.slice(ENRICH_LIMIT);
    const { pools: enriched, filtered: enrichFiltered } = await enrichCandidates(topPools, config.screening);
    for (const f of enrichFiltered) {
      pushFilteredReason(filteredOut, f, f.reason);
      log("screening", `Enrichment filtered ${f.name || 'unknown'} — ${f.reason}`);
    }
    eligible.splice(0, eligible.length, ...enriched, ...restPools);
  }

  // Verified + JupShield hard filter — reject pools whose tokens are NOT verified and do NOT have JupShield
  // Enriched pools have this data; un-enriched pools pass through with a warning
  if (eligible.length > 0) {
    const before = eligible.length;
    const verifiedEligible = eligible.filter((pool) => {
      const enr = pool._enrichment || {};
      if (enr.jupVerified === undefined && enr.jupShielded === undefined) {
        // Un-enriched pool — cannot verify, pass through
        pool.unverified = true;
        return true;
      }
      const isVerified = enr.jupVerified === true;
      const hasShield = enr.jupShielded === true;
      // Token must be either verified OR shielded to pass
      if (enr.jupVerified === false && enr.jupShielded === false) {
        const requireVerified = config.screening.requireVerifiedOrShield !== false;
        if (requireVerified) {
          pushFilteredReason(filteredOut, pool, "token not verified/JupShield on Jupiter");
          log("screening", `Verified+shield filter: ${pool.name} — NOT verified and no JupShield`);
          return false;
        }
        // Allow unverified but tag as higher risk
        pool.unverified = true;
        log("screening", `Unverified token allowed: ${pool.name} — tagged as higher risk, reduced deploy size`);
        return true;
      }
      if (!isVerified && enr.jupVerified === false) {
        // Not verified, but has shield — allow (shield implies monitored)
        pool.unverified = false;
        return true;
      }
      pool.unverified = !isVerified && !hasShield;
      return true;
    });
    eligible.splice(0, eligible.length, ...verifiedEligible);
    if (eligible.length < before) {
      log("screening", `Verified+JupShield filter removed ${before - eligible.length} candidate(s)`);
    }
  }

  // Apply mcap/holders/volume filters using best available data (pool direct fields + enrichment)
  if (eligible.length > 0) {
    const s = config.screening;
    const before = eligible.length;
    const filtered = [];
    for (const pool of eligible) {
      const enr = pool._enrichment || {};
      // Prefer Jupiter data over Birdeye (Jupiter DatAPI works without API key, more reliable for Solana tokens)
      const bestMcap = enr.jupiterMarketCap || enr.birdeyeMarketCap || pool.mcap || pool.marketCap;
      const bestHolders = enr.jupiterHolders || enr.birdeyeHolders || pool.holders;
      const bestVolume = enr.jupiterVolume24h || enr.birdeyeVolume24h || enr.dexVolume24h || pool.volume_window;

      if (bestMcap != null && bestMcap < s.minMcap) {
        pushFilteredReason(filteredOut, pool, `mcap ${bestMcap} below minMcap ${s.minMcap}`);
        continue;
      }
      if (bestMcap != null && bestMcap > s.maxMcap) {
        pushFilteredReason(filteredOut, pool, `mcap ${bestMcap} above maxMcap ${s.maxMcap}`);
        continue;
      }
      if (bestHolders != null && bestHolders < s.minHolders) {
        pushFilteredReason(filteredOut, pool, `holders ${bestHolders} below minHolders ${s.minHolders}`);
        continue;
      }
      if (bestVolume != null && bestVolume < s.minVolume) {
        pushFilteredReason(filteredOut, pool, `volume ${bestVolume} below minVolume ${s.minVolume}`);
        continue;
      }

      // Back-fill normalized fields for downstream consumers (condensePool, scoreCandidate)
      if (bestMcap != null) {
        pool.mcap = bestMcap;
        pool.marketCap = bestMcap;
      }
      if (bestVolume != null) {
        pool.volume_window = bestVolume;
      }
      if (bestHolders != null) {
        pool.holders = bestHolders;
      }
      // Back-fill fee_active_tvl_ratio from DLMM enrichment (pool discovery API often returns null)
      if (enr.feeActiveTvlRatio != null && (pool.fee_active_tvl_ratio == null || pool.fee_active_tvl_ratio === 0)) {
        pool.fee_active_tvl_ratio = enr.feeActiveTvlRatio;
      }
      filtered.push(pool);
    }
    eligible.splice(0, eligible.length, ...filtered);
    if (eligible.length < before) {
      log("screening", `Mcap/holders/volume filters removed ${before - eligible.length} candidate(s)`);
    }
  }

  if (config.screening.avoidPvpSymbols && eligible.length > 0) {
    await enrichPvpRisk(eligible);
    if (config.screening.blockPvpSymbols) {
      const before = eligible.length;
      const pvpRemoved = eligible.filter((p) => p.is_pvp);
      pvpRemoved.forEach((p) => pushFilteredReason(filteredOut, p, "PVP hard filter"));
      eligible.splice(0, eligible.length, ...eligible.filter((p) => !p.is_pvp));
      if (eligible.length < before) {
        log("screening", `PVP hard filter removed ${before - eligible.length} pool(s)`);
      }
    }
  }

  // Dev blocklist check — filter pools whose creator is on the blocklist
  if (eligible.length > 0) {
    const before = eligible.length;
    const filtered = eligible.filter((p) => {
      if (p.dev && isDevBlocked(p.dev)) {
        log("dev_blocklist", `Filtered blocked deployer ${p.dev.slice(0, 8)} token ${p.base?.symbol}`);
        pushFilteredReason(filteredOut, p, "blocked deployer");
        return false;
      }
      return true;
    });
    eligible.splice(0, eligible.length, ...filtered);
    if (eligible.length < before) log("dev_blocklist", `Filtered ${before - eligible.length} pool(s) via dev blocklist`);
  }

  if (config.indicators.enabled && eligible.length > 0) {
    const confirmations = await Promise.all(
      eligible.map(async (pool) => {
        try {
          const confirmation = await confirmIndicatorPreset({
            mint: pool.base?.mint,
            side: "entry",
          });
          return { pool: pool.pool, confirmation };
        } catch (error) {
          return {
            pool: pool.pool,
            confirmation: {
              enabled: true,
              confirmed: true,
              skipped: true,
              reason: `Indicator confirmation unavailable: ${error.message}`,
              intervals: [],
            },
          };
        }
      }),
    );
    const confirmationByPool = new Map(confirmations.map((entry) => [entry.pool, entry.confirmation]));
    const before = eligible.length;
    const confirmedEligible = eligible.filter((pool) => {
      const confirmation = confirmationByPool.get(pool.pool);
      pool.indicator_confirmation = confirmation || null;
      if (!confirmation || confirmation.confirmed) return true;
      pushFilteredReason(filteredOut, pool, `indicator reject: ${confirmation.reason}`);
      log("screening", `Indicator rejected ${pool.name} (${pool.pool}): ${confirmation.reason}`);
      return false;
    });
    eligible.splice(0, eligible.length, ...confirmedEligible);
    if (eligible.length < before) {
      log("screening", `Indicator confirmation removed ${before - eligible.length} candidate(s)`);
    }
  }

  return {
    candidates: eligible,
    total_screened: allPools.length,
    source: "multi",
    filtered_examples: filteredOut.slice(0, 3),
    all_filtered: filteredOut,
  };
}

/**
 * Get full raw details for a specific pool.
 * Fetches top 50 pools from discovery API and finds the matching address.
 * Returns the full unfiltered API object (all fields, not condensed).
 */
export async function getPoolDetail({ pool_address, timeframe = "5m" }) {
  const pool = await fetchPoolDiscoveryDetail({ poolAddress: pool_address, timeframe });

  if (!pool) {
    throw new Error(`Pool ${pool_address} not found`);
  }

  return pool;
}

/**
 * Condense a pool object for LLM consumption.
 * Raw API returns ~100+ fields per pool. The LLM only needs ~20.
 */
function condensePool(p) {
  return {
    pool: p.pool_address,
    name: p.name,
    base: {
      symbol: p.token_x?.symbol,
      mint: p.token_x?.address,
      organic: Math.round(p.token_x?.organic_score || 0),
      warnings: p.token_x?.warnings?.length || 0,
    },
    quote: {
      symbol: p.token_y?.symbol,
      mint: p.token_y?.address,
    },
    pool_type: p.pool_type,
    bin_step: p.dlmm_params?.bin_step || null,
    fee_pct: p.fee_pct,

    // Core metrics (the numbers that matter)
    tvl: round(p.tvl),
    active_tvl: round(p.active_tvl),
    fee_window: round(p.fee),
    volume_window: round(p.volume),
    fee_active_tvl_ratio: p.fee_active_tvl_ratio != null ? fix(p.fee_active_tvl_ratio, 4) : null,
    volatility: fix(p.volatility, 4),
    volatility_timeframe: p.volatility_timeframe || getVolatilityTimeframe(config.screening.timeframe),

    // Per-timeframe breakdown (populated when sourceTimeframe !== volatilityTimeframe)
    ...(p.volatility_timeframe && p.volatility_timeframe !== config.screening.timeframe ? {
      [`volume_${config.screening.timeframe}`]: round(p[`volume_${config.screening.timeframe}`] ?? null),
      [`volume_${p.volatility_timeframe}`]: round(p[`volume_${p.volatility_timeframe}`] ?? null),
      [`volatility_${config.screening.timeframe}`]: fix(p[`volatility_${config.screening.timeframe}`] ?? null, 4),
      [`volatility_${p.volatility_timeframe}`]: fix(p[`volatility_${p.volatility_timeframe}`] ?? null, 4),
    } : {}),


    // Token health
    holders: p.base_token_holders,
    mcap: round(p.token_x?.market_cap),
    organic_score: Math.round(p.token_x?.organic_score || 0),
    token_age_hours: p.token_x?.created_at
      ? Math.floor((Date.now() - p.token_x.created_at) / 3_600_000)
      : null,
    dev: p.token_x?.dev || null,
    launchpad: getPoolLaunchpad(p),

    // Position health
    active_positions: p.active_positions,
    active_pct: fix(p.active_positions_pct, 1),
    open_positions: p.open_positions,
    discord_signal: Boolean(p.discord_signal),
    discord_signal_count: p.discord_signal_count || 0,
    discord_signal_seen_count: p.discord_signal_seen_count || 0,
    discord_signal_last_seen_at: p.discord_signal_last_seen_at || null,

    // Price action
    price: p.pool_price,
    price_change_pct: fix(p.pool_price_change_pct, 1),
    price_trend: p.price_trend,
    min_price: p.min_price,
    max_price: p.max_price,

    // Activity trends
    volume_change_pct: fix(p.volume_change_pct, 1),
    fee_change_pct: fix(p.fee_change_pct, 1),
    swap_count: p.swap_count,
    unique_traders: p.unique_traders,
    unverified: p.unverified ?? null,
  };
}

function round(n) {
  return n != null ? Math.round(n) : null;
}

function fix(n, decimals) {
  const value = numeric(n);
  return value != null ? Number(value.toFixed(decimals)) : null;
}

function pushFilteredReason(list, pool, reason) {
  if (!list || !pool) return;
  list.push({
    name: pool.name || `${pool.base?.symbol || "?"}-${pool.quote?.symbol || "?"}`,
    reason,
  });
}
