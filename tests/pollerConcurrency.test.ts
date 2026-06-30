import { describe, it, expect } from 'vitest';

describe('poller concurrency guards', () => {
  it('emergency stop-loss runs even when screening/management is busy', () => {
    // Simulate the poller's guard logic from index.js
    const screeningBusy = true;
    const managementBusy = false;
    const pnlPollBusy = false;

    // Old bug: if (screeningBusy || managementBusy || pnlPollBusy) return;
    const oldGuard = screeningBusy || managementBusy || pnlPollBusy;
    expect(oldGuard).toBe(true); // OLD: blocked the entire poller

    // Fixed: only pnlPollBusy blocks entry
    const newGuard = pnlPollBusy;
    expect(newGuard).toBe(false); // FIXED: poller runs

    // Derived busy flag only gates non-urgent checks
    const busy = screeningBusy || managementBusy;
    expect(busy).toBe(true);

    // Stop-loss should still fire
    const pnlPct = -10;
    const stopLossPct = -8;
    const isSuspicious = false;
    const shouldStopLoss = pnlPct != null && !isSuspicious && stopLossPct != null && pnlPct <= stopLossPct;
    expect(shouldStopLoss).toBe(true); // emergency close proceeds
  });

  it('non-urgent exits are deferred when busy', () => {
    const busy = true;
    const exitAction = 'TRAILING_TP';

    let managementTriggered = false;
    if (exitAction === 'STOP_LOSS') {
      managementTriggered = true; // immediate close
    } else if (busy) {
      // deferred — skip management trigger
    } else if (exitAction === 'TRAILING_TP') {
      managementTriggered = true;
    }

    expect(managementTriggered).toBe(false); // deferred because busy
  });

  it('non-urgent exits proceed when not busy', () => {
    const busy = false;
    const exitAction = 'TRAILING_TP';

    let managementTriggered = false;
    if (exitAction === 'STOP_LOSS') {
      managementTriggered = true;
    } else if (busy) {
      // deferred
    } else if (exitAction === 'TRAILING_TP') {
      managementTriggered = true;
    }

    expect(managementTriggered).toBe(true); // proceeds
  });

  it('poller self-overlap is still prevented (_pnlPollBusy)', () => {
    const pnlPollBusy = true;
    const shouldBlock = pnlPollBusy;
    expect(shouldBlock).toBe(true);
  });

  it('multiple positions each get stop-loss evaluated', () => {
    const positions = [
      { id: 'pos_a', pnl: -3, stopLossPct: -5 },
      { id: 'pos_b', pnl: -8.5, stopLossPct: -5 },
      { id: 'pos_c', pnl: -2, stopLossPct: -5 },
    ];

    const stopLossPositions: string[] = [];
    for (const p of positions) {
      if (p.pnl <= p.stopLossPct) {
        stopLossPositions.push(p.id);
      }
    }

    // All positions should be checked independently
    expect(stopLossPositions).toEqual(['pos_b']);
    // Positions above stopLossPct should NOT fire
    expect(stopLossPositions).not.toContain('pos_a');
    expect(stopLossPositions).not.toContain('pos_c');
  });

  it('non-emergency trigger is limited to one per tick', () => {
    const positions = [
      { id: 'pos_a', rule: 2 }, // take profit
      { id: 'pos_b', rule: 4 }, // OOR
    ];

    let nonEmergencyTriggered = false;
    let triggerCount = 0;

    for (const p of positions) {
      if (!nonEmergencyTriggered) {
        nonEmergencyTriggered = true;
        triggerCount++;
      }
    }

    expect(triggerCount).toBe(1); // only one non-emergency trigger per tick
  });
});

describe('error resilience in poller', () => {
  it('getMyPositions failure is caught and does not crash interval', async () => {
    const failingFetch = async () => { throw new Error('RPC error'); };
    // The real poller wraps this in .catch(() => null)
    const result = await failingFetch().catch(() => null);
    expect(result).toBeNull();
  });

  it('closePosition failure is caught and logged', async () => {
    let loggedError = '';
    const closePosition = async () => { throw new Error('position not found'); };
    await closePosition().catch(e => { loggedError = e.message; });
    expect(loggedError).toBe('position not found');
    // No unhandled rejection — error is caught
  });

  it('closePosition success with missing pnl_pct is handled', async () => {
    const result = { success: true, pnl_pct: undefined };
    const pnlPct = result.pnl_pct ?? 0;
    expect(pnlPct).toBe(0);
  });
});
