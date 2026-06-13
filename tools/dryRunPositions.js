import fs from "fs";
import { log } from "../logger.js";
import { repoPath } from "../repo-root.js";

const DRY_RUN_POSITIONS_FILE = repoPath("data", "dry-run-positions.json");

function load() {
  if (!fs.existsSync(DRY_RUN_POSITIONS_FILE)) return { positions: [] };
  try {
    return JSON.parse(fs.readFileSync(DRY_RUN_POSITIONS_FILE, "utf8"));
  } catch (err) {
    log("dry_run_positions", `Failed to read dry-run-positions.json: ${err.message}`);
    return { positions: [] };
  }
}

function save(data) {
  try {
    fs.mkdirSync(repoPath("data"), { recursive: true });
    fs.writeFileSync(DRY_RUN_POSITIONS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log("dry_run_positions", `Failed to write dry-run-positions.json: ${err.message}`);
  }
}

export function trackDryRunPosition({
  pool_address,
  pool_name,
  amount_y,
  strategy,
  bins_below,
  bins_above,
  active_bin,
  bin_step,
  active_price,
  volatility,
  lane,
  regime,
  psychology,
  lp_alpha_score,
  deploy_source,
  base_mint,
  entry_tvl,
}) {
  const data = load();
  const position = {
    id: `${pool_address}-${Date.now()}`,
    pool_address,
    pool_name,
    amount_y: Number(amount_y),
    strategy,
    bins_below: Number(bins_below),
    bins_above: Number(bins_above),
    active_bin: Number(active_bin),
    bin_step: Number(bin_step),
    active_price: Number(active_price),
    volatility: volatility != null ? Number(volatility) : null,
    lane: lane || null,
    regime: regime || null,
    psychology: psychology || null,
    lp_alpha_score: lp_alpha_score != null ? Number(lp_alpha_score) : null,
    deploy_source: deploy_source || "ai_chosen",
    base_mint: base_mint || null,
    entry_tvl: entry_tvl != null ? Number(entry_tvl) : null,
    deployed_at: new Date().toISOString(),
    closed_at: null,
    simulated_pnl_pct: null,
    simulated_fees: null,
    close_reason: null,
  };
  data.positions.push(position);
  save(data);
  log("dry_run_positions", `Tracked dry-run position ${pool_name || pool_address?.slice(0, 8)} (${position.id.slice(0, 12)})`);
  return position;
}

export function getDryRunPositions({ includeClosed = false } = {}) {
  const data = load();
  if (includeClosed) return data.positions;
  return data.positions.filter(p => p.closed_at == null);
}

export function closeDryRunPosition(positionId, { pnl_pct, fees_earned, reason } = {}) {
  const data = load();
  const pos = data.positions.find(p => p.id === positionId);
  if (!pos) {
    log("dry_run_positions", `closeDryRunPosition: position ${positionId?.slice(0, 12)} not found`);
    return null;
  }
  if (pos.closed_at) {
    log("dry_run_positions", `closeDryRunPosition: position ${positionId?.slice(0, 12)} already closed`);
    return pos;
  }
  pos.closed_at = new Date().toISOString();
  pos.simulated_pnl_pct = pnl_pct != null ? Number(pnl_pct) : null;
  pos.simulated_fees = fees_earned != null ? Number(fees_earned) : null;
  pos.close_reason = reason || "manual";
  save(data);
  log("dry_run_positions", `Closed dry-run position ${pos.pool_name || pos.pool_address?.slice(0, 8)} pnl=${pnl_pct ?? "?"}% reason=${reason}`);
  return pos;
}

export function evaluateDryRunPositions(currentPositions) {
  const open = getDryRunPositions();
  if (open.length === 0) return [];

  const currentMap = {};
  for (const cp of currentPositions) {
    currentMap[cp.pool] = cp;
  }

  const results = [];
  for (const pos of open) {
    const live = currentMap[pos.pool_address];
    if (!live) {
      results.push({ ...pos, simulated_pnl_pct: null, simulated_fees: null, status: "no_data" });
      continue;
    }
    const pnlPct = live.pnl_pct != null ? Number(live.pnl_pct) : null;
    const feesUsd = live.unclaimed_fees_usd != null ? Number(live.unclaimed_fees_usd) : null;
    results.push({ ...pos, simulated_pnl_pct: pnlPct, simulated_fees: feesUsd, status: "tracking", live_pool: live });
  }
  return results;
}

export function getDryRunPositionsSummary() {
  const open = getDryRunPositions();
  const closed = getDryRunPositions({ includeClosed: true }).filter(p => p.closed_at != null);

  if (open.length === 0 && closed.length === 0) return "No dry-run positions recorded.";

  const lines = [];
  if (open.length > 0) {
    lines.push(`📋 Open DRY RUN Positions (${open.length}):`);
    for (const p of open) {
      const age = p.deployed_at ? Math.round((Date.now() - new Date(p.deployed_at).getTime()) / 60000) : "?";
      lines.push(`  ${p.pool_name || p.pool_address?.slice(0, 8)} | ${p.amount_y} SOL | ${age}m | TVL: $${p.entry_tvl?.toLocaleString() || "?"}`);
    }
  }
  if (closed.length > 0) {
    lines.push(`\n📦 Closed (${closed.length}):`);
    for (const p of closed.slice(-5)) {
      lines.push(`  ${p.pool_name || p.pool_address?.slice(0, 8)} | PnL: ${p.simulated_pnl_pct != null ? p.simulated_pnl_pct + "%" : "?"} | Reason: ${p.close_reason || "?"}`);
    }
  }
  return lines.join("\n");
}
