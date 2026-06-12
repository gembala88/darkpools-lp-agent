import fs from 'fs';
import { repoPath } from '../../repo-root.js';
import { log } from '../../logger.js';

const MEMORY_FILE = () => repoPath('data', 'deployment-memory.json');

/**
 * Re-fetch a pool's current state from the Meteora discovery API.
 * Returns { tvl, price, volume, feePct, fee_active_tvl_ratio } or null on failure.
 */
async function fetchPoolCurrentState(poolAddress) {
  try {
    const { getPoolDetail } = await import('../../tools/screening.js');
    const detail = await getPoolDetail({ pool_address: poolAddress, timeframe: '5m' });
    if (!detail) return null;
    return {
      tvl: detail.active_tvl ?? detail.tvl ?? null,
      price: detail.pool_price ?? null,
      volume24h: detail.volume_window ?? null,
      feePct: detail.fee_pct ?? null,
      fee_active_tvl_ratio: detail.fee_active_tvl_ratio ?? null,
    };
  } catch {
    try {
      // Fallback: direct fetch from dlmm-api (individual pool endpoint)
      const res = await fetch(`https://dlmm-api.meteora.ag/pool/${poolAddress}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data) return null;
      return {
        tvl: data.active_tvl ?? data.tvl ?? null,
        price: data.pool_price ?? null,
        volume24h: data.volume ?? null,
        feePct: data.fee_pct ?? null,
        fee_active_tvl_ratio: data.fee_active_tvl_ratio ?? null,
      };
    } catch {
      return null;
    }
  }
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
  if (feesEarned > 0 && tvlChange != null && tvlChange > -0.10) return 'PROFIT';
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

      if (ageHours >= 4 && deploy.outcome4h == null) {
        log("deploy", `[OUTCOME] Checking 4h for ${deploy.name}...`);
        const state = await fetchPoolCurrentState(deploy.poolAddress || deploy.pool_address);
        if (!state) {
          log("deploy", `[OUTCOME] Fetch failed for ${deploy.name} — will retry next cycle`);
          continue;
        }

        const entryTvl = deploy.entryTvl ?? 0;
        const entryPrice = deploy.entryPrice ?? null;
        const holdingHours = 4;

        const outcome = {
          checkedAt: new Date().toISOString(),
          currentTvl: state.tvl,
          tvlChange: entryTvl > 0 ? (state.tvl - entryTvl) / entryTvl : null,
          feesEarned: estimateFeesEarned(state, holdingHours),
          priceChange: (entryPrice != null && state.price != null) ? (state.price - entryPrice) / entryPrice : null,
          note: 'SIMULATED (computed from discovery data)',
        };
        deploy.outcome4h = outcome;
        deploy.verdict = determineVerdict(outcome);
        changed = true;

        const line = `📊 [SIM] Outcome ${deploy.name}: ${deploy.verdict} | TVLΔ=${(outcome.tvlChange != null ? (outcome.tvlChange * 100).toFixed(1) : '?')}% | fees=$${outcome.feesEarned.toFixed(2)} | source=${deploy.deploySource ?? 'ai_chosen'}`;
        log("deploy", `[OUTCOME] ${line}`);
        try {
          const { sendToChannel } = await import('../../telegram.js');
          sendToChannel(line, "info").catch(() => {});
        } catch (_) {}
      } else if (ageHours >= 1 && deploy.outcome1h == null) {
        log("deploy", `[OUTCOME] Checking 1h for ${deploy.name}...`);
        const state = await fetchPoolCurrentState(deploy.poolAddress || deploy.pool_address);
        if (!state) {
          log("deploy", `[OUTCOME] Fetch failed for ${deploy.name} at 1h — will retry next cycle`);
          continue;
        }

        const entryTvl = deploy.entryTvl ?? 0;
        const entryPrice = deploy.entryPrice ?? null;
        const holdingHours = 1;

        deploy.outcome1h = {
          checkedAt: new Date().toISOString(),
          currentTvl: state.tvl,
          tvlChange: entryTvl > 0 ? (state.tvl - entryTvl) / entryTvl : null,
          feesEarned: estimateFeesEarned(state, holdingHours),
          priceChange: (entryPrice != null && state.price != null) ? (state.price - entryPrice) / entryPrice : null,
          note: 'SIMULATED (computed from discovery data)',
        };
        changed = true;
        log("deploy", `[OUTCOME] 1h check for ${deploy.name}: TVLΔ=${(deploy.outcome1h.tvlChange != null ? (deploy.outcome1h.tvlChange * 100).toFixed(1) : '?')}% | fees=$${deploy.outcome1h.feesEarned.toFixed(2)}`);
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
