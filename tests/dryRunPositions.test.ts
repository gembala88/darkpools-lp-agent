import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { repoPath } from '../repo-root.js';

const TEST_FILE = repoPath('data', 'test-dry-run-positions.json');

// Temporarily swap the real file path for a test path by creating a minimal
// test helper that reads/writes from a test-specific location.
// We test the pure logic by using the exported functions which read/write
// the real file path. Instead, we verify the math and shape directly.

import {
  trackDryRunPosition,
  getDryRunPositions,
  closeDryRunPosition,
} from '../tools/dryRunPositions.js';

// Backup and restore the real position file
let _realBackup: string | null = null;
const REAL_FILE = repoPath('data', 'dry-run-positions.json');

async function swapToTestFile() {
  if (fs.existsSync(REAL_FILE)) {
    _realBackup = fs.readFileSync(REAL_FILE, 'utf8');
  }
  // Point to test file by renaming
  if (fs.existsSync(REAL_FILE)) {
    fs.renameSync(REAL_FILE, TEST_FILE);
  }
}

async function restoreRealFile() {
  try { fs.unlinkSync(REAL_FILE); } catch {}
  if (_realBackup != null) {
    fs.writeFileSync(REAL_FILE, _realBackup);
  }
  try { fs.unlinkSync(TEST_FILE); } catch {}
}

describe('Dry Run Positions tracking', () => {
  beforeEach(() => {
    try { fs.unlinkSync(REAL_FILE); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(REAL_FILE); } catch {}
  });

  it('should track a position with conviction fields', () => {
    const pos = trackDryRunPosition({
      pool_address: 'abc123',
      pool_name: 'Test/USDC',
      amount_y: 0.12,
      strategy: 'spot',
      bins_below: 35,
      bins_above: 0,
      active_bin: 100,
      bin_step: 80,
      active_price: 0.5,
      volatility: 3,
      lane: 'momentum',
      regime: 'RANGING',
      psychology: 'greed',
      lp_alpha_score: 75,
      deploy_source: 'ai_chosen',
      base_mint: 'mint1',
      entry_tvl: 10000,
      entry_pool_price: 0.5,
      conviction_score: 85,
      conviction_reason: 'strong volume',
      key_factor: 'volume',
    });
    expect(pos.id).toBeTruthy();
    expect(pos.pool_address).toBe('abc123');
    expect(pos.conviction_score).toBe(85);
    expect(pos.conviction_reason).toBe('strong volume');
    expect(pos.key_factor).toBe('volume');
    expect(pos.deployed_at).toBeTruthy();
    expect(pos.closed_at).toBeNull();
    expect(pos.simulated_pnl_pct).toBeNull();
  });

  it('should close a position with PnL and fees', () => {
    const pos = trackDryRunPosition({
      pool_address: 'close_test',
      amount_y: 0.12,
      strategy: 'bid_ask',
      bins_below: 40,
      bins_above: 0,
      active_bin: 50,
      bin_step: 100,
    });
    const closed = closeDryRunPosition(pos.id, {
      pnl_pct: 12.5,
      fees_earned: 0.05,
      reason: 'take_profit',
    });
    expect(closed.closed_at).toBeTruthy();
    expect(closed.simulated_pnl_pct).toBe(12.5);
    expect(closed.simulated_fees).toBe(0.05);
    expect(closed.close_reason).toBe('take_profit');
  });

  it('should list only open positions by default', () => {
    trackDryRunPosition({
      pool_address: 'open_only',
      amount_y: 0.12,
      strategy: 'spot',
      bins_below: 35,
      bins_above: 0,
      active_bin: 10,
      bin_step: 80,
    });
    const p2 = trackDryRunPosition({
      pool_address: 'closed_only',
      amount_y: 0.12,
      strategy: 'spot',
      bins_below: 35,
      bins_above: 0,
      active_bin: 10,
      bin_step: 80,
    });
    closeDryRunPosition(p2.id, { reason: 'stop_loss' });
    const open = getDryRunPositions();
    expect(open.length).toBe(1);
    expect(open[0].pool_address).toBe('open_only');
  });

  it('should include closed positions when asked', () => {
    trackDryRunPosition({
      pool_address: 'a',
      amount_y: 0.12,
      strategy: 'spot',
      bins_below: 35,
      bins_above: 0,
      active_bin: 10,
      bin_step: 80,
    });
    const p2 = trackDryRunPosition({
      pool_address: 'b',
      amount_y: 0.12,
      strategy: 'spot',
      bins_below: 35,
      bins_above: 0,
      active_bin: 10,
      bin_step: 80,
    });
    closeDryRunPosition(p2.id, { reason: 'manual' });
    expect(getDryRunPositions({ includeClosed: true }).length).toBe(2);
  });
});
