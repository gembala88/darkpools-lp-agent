import fs from 'fs';
import { repoPath } from '../../repo-root.js';
import { log } from '../../logger.js';

const MEMORY_FILE = () => repoPath('data', 'deployment-memory.json');

/**
 * Re-fetch a pool's current state from the Meteora discovery API (same live
 * source the screening cycle uses successfully each cycle).
 * Returns { tvl, price, volume24h, feePct } or null on failure.
 */
async function fetchPoolCurrentState(poolAddress) {
  // Primary: pool-discovery-api.datapi.meteora.ag (same endpoint as screening's fetchPoolDiscoveryDetail)
  try {
    const base = 'https://pool-discovery-api.datapi.meteora.ag';
    const url = `${base}/pools?page_size=1&filter_by=${encodeURIComponent('pool_address=' + poolAddress)}&timeframe=5m`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const body = await res.json();
      const pool = (body.data || [])[0];
      if (pool) {
        const state = {
          tvl: pool.active_tvl ?? pool.tvl ?? null,
          price: pool.pool_price ?? null,
          volume24h: pool.volume ?? null,
          feePct: pool.fee_pct ?? null,
        };
        log("deploy", `[OUTCOME] fetchPoolState ${poolAddress.slice(0, 8)} → tvl=${state.tvl} price=${state.price}`);
        return state;
      }
    }
    log("deploy", `[OUTCOME] fetchPoolState ${poolAddress.slice(0, 8)} → discovery returned no pool`);
  } catch (e) {
    log("deploy", `[OUTCOME] fetchPoolState ${poolAddress.slice(0, 8)} discovery error: ${e.message}`);
  }

  // Fallback: DexScreener by pool address
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${poolAddress}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const body = await res.json();
      const pair = (body.pairs || []).find(p => p.pairAddress === poolAddress || p.pairAddress?.toLowerCase() === poolAddress.toLowerCase());
      if (pair) {
        const state = {
          tvl: pair.liquidity?.usd ?? null,
          price: pair.priceUsd ? Number(pair.priceUsd) : null,
          volume24h: pair.volume?.h24 ?? null,
          feePct: null,
        };
        log("deploy", `[OUTCOME] fetchPoolState ${poolAddress.slice(0, 8)} → dexscreener tvl=${state.tvl} price=${state.price}`);
        return state;
      }
    }
  } catch (e) {
    log("deploy", `[OUTCOME] fetchPoolState ${poolAddress.slice(0, 8)} dexscreener error: ${e.message}`);
  }

  log("deploy", `[OUTCOME] fetchPoolState ${poolAddress.slice(0, 8)} → FAILED (both sources exhausted)`);
  return null;
}

/**
 * Compute estimated fees earned over the holding period.
 * Uses the pool's current 24h volume * fee rate * (holdingHours / 24).
 */
function estimateFeesEarned(currentState, holdingHours) {
  if (!currentState) return 0;
  const vol24h = currentState.volume24h ?? 0;
  if (vol24h <= 0) return 0;
  const feeRate = currentState.feePct != null
    ? currentState.feePct / 100
    : (currentState.fee_active_tvl_ratio != null ? currentState.fee_active_tvl_ratio / 100 : 0.003);
  return vol24h * feeRate * Math.min(holdingHours / 24, 1);
}

/**
 * Determine final verdict from outcome metrics.
 */
function determineVerdict(outcome) {
  const { tvlChange, feesEarned, priceChange } = outcome;

  // Price crash / rug — immediate LOSS regardless of TVL/fees
  if (priceChange != null && priceChange < -0.50) return 'LOSS';

  // Absurd TVL swing from near-zero entry — mark ANOMALY, exclude from win-rate
  if (tvlChange != null && tvlChange > 5.0) return 'ANOMALY';

  // Genuine profit: fees earned, price stable (or better), TVL in sane range
  if (feesEarned > 0 && tvlChange != null && tvlChange > -0.10 && tvlChange <= 5.0) {
    if (priceChange == null || priceChange > -0.10) return 'PROFIT';
  }

  // Clear loss signals
  if (tvlChange != null && tvlChange < -0.20) return 'LOSS';
  if (priceChange != null && priceChange < -0.15) return 'LOSS';

  return 'NEUTRAL';
}

export async function checkOutcomes() {
  try {
    const absPath = MEMORY_FILE();
    if (!fs.existsSync(absPath)) return;

    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const deploys = raw.deploys || [];
    const pending = deploys.filter(d => d.verdict === 'PENDING').length;
    log("deploy", `[OUTCOME] checkOutcomes running — ${deploys.length} deploys, ${pending} pending`);
    let changed = false;

    for (const deploy of deploys) {
      if (deploy.verdict !== 'PENDING') continue;

      const entryTime = new Date(deploy.entryTime).getTime();
      if (!entryTime) continue;
      const now = Date.now();
      const ageHours = (now - entryTime) / (1000 * 60 * 60);

      // Independent checks — both can fire in the same cycle (e.g. 9h-old deploy)
      if (ageHours >= 1 && deploy.outcome1h == null) {
        log("deploy", `[OUTCOME] Checking 1h for ${deploy.name}...`);
        const state = await fetchPoolCurrentState(deploy.poolAddress || deploy.pool_address);
        if (state) {
          const entryTvl = deploy.entryTvl ?? 0;
          const entryPrice = deploy.entryPrice ?? null;
          deploy.outcome1h = {
            checkedAt: new Date().toISOString(),
            currentTvl: state.tvl,
            tvlChange: entryTvl > 0 ? (state.tvl - entryTvl) / entryTvl : null,
            feesEarned: estimateFeesEarned(state, 1),
            priceChange: (entryPrice != null && state.price != null) ? (state.price - entryPrice) / entryPrice : null,
            note: 'SIMULATED (computed from discovery data)',
          };
          changed = true;
          log("deploy", `[OUTCOME] ${deploy.name} 1h saved — TVLΔ=${(deploy.outcome1h.tvlChange != null ? (deploy.outcome1h.tvlChange * 100).toFixed(1) : '?')}% fees=$${deploy.outcome1h.feesEarned.toFixed(2)}`);
        } else {
          log("deploy", `[OUTCOME] ${deploy.name} 1h fetch failed — will retry`);
        }
      }

      if (ageHours >= 4 && deploy.outcome4h == null) {
        log("deploy", `[OUTCOME] Checking 4h for ${deploy.name}...`);
        const state = await fetchPoolCurrentState(deploy.poolAddress || deploy.pool_address);
        if (state) {
          const entryTvl = deploy.entryTvl ?? 0;
          const entryPrice = deploy.entryPrice ?? null;
          const outcome = {
            checkedAt: new Date().toISOString(),
            currentTvl: state.tvl,
            tvlChange: entryTvl > 0 ? (state.tvl - entryTvl) / entryTvl : null,
            feesEarned: estimateFeesEarned(state, 4),
            priceChange: (entryPrice != null && state.price != null) ? (state.price - entryPrice) / entryPrice : null,
            note: 'SIMULATED (computed from discovery data)',
          };
          deploy.outcome4h = outcome;
          deploy.verdict = determineVerdict(outcome);
          changed = true;

          log("deploy", `[OUTCOME] ${deploy.name} 4h saved, verdict=${deploy.verdict} — TVLΔ=${(outcome.tvlChange != null ? (outcome.tvlChange * 100).toFixed(1) : '?')}% fees=$${outcome.feesEarned.toFixed(2)}`);

          const line = `📊 [SIM] Outcome ${deploy.name}: ${deploy.verdict} | TVLΔ=${(outcome.tvlChange != null ? (outcome.tvlChange * 100).toFixed(1) : '?')}% | fees=$${outcome.feesEarned.toFixed(2)} | source=${deploy.deploySource ?? 'ai_chosen'}`;
          try {
            const { notify } = await import('../../telegram.js');
            notify(line, "info").catch(() => {});
          } catch (_) {}
        } else {
          log("deploy", `[OUTCOME] ${deploy.name} 4h fetch failed — will retry`);
        }
      }
    }

    if (changed) {
      fs.writeFileSync(absPath, JSON.stringify(raw, null, 2));
      const completed = deploys.filter(d => d.verdict !== 'PENDING').length;
      log("deploy", `[OUTCOME] Updated ${completed}/${deploys.length} entries`);
    }
  } catch (e) {
    log("deploy", `[OUTCOME] checkOutcomes error: ${e.message} | ${e.stack}`);
  }
}
