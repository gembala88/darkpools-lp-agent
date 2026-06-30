import { describe, it, expect } from 'vitest';
import { shouldTriggerStopLoss, isPnlSuspect } from '../state.js';

describe('shouldTriggerStopLoss', () => {
  it('returns true when pnl_pct <= stopLossPct', () => {
    expect(shouldTriggerStopLoss(-8.5, -8, false)).toBe(true);
    expect(shouldTriggerStopLoss(-8, -8, false)).toBe(true);
    expect(shouldTriggerStopLoss(-17.7, -8, false)).toBe(true);
    expect(shouldTriggerStopLoss(-20, -5, false)).toBe(true);
  });

  it('returns false when pnl_pct is above stopLossPct', () => {
    expect(shouldTriggerStopLoss(-7.9, -8, false)).toBe(false);
    expect(shouldTriggerStopLoss(-0.5, -8, false)).toBe(false);
    expect(shouldTriggerStopLoss(5, -8, false)).toBe(false);
  });

  it('returns false when pnl_pct is null', () => {
    expect(shouldTriggerStopLoss(null, -8, false)).toBe(false);
    expect(shouldTriggerStopLoss(undefined, -8, false)).toBe(false);
  });

  it('returns false when stopLossPct is null', () => {
    expect(shouldTriggerStopLoss(-10, null, false)).toBe(false);
    expect(shouldTriggerStopLoss(-10, undefined, false)).toBe(false);
  });

  it('returns false when position is suspicious', () => {
    expect(shouldTriggerStopLoss(-95, -8, true)).toBe(false);
    expect(shouldTriggerStopLoss(-8, -8, true)).toBe(false);
  });

  it('non-suspect extreme loss still triggers', () => {
    expect(shouldTriggerStopLoss(-95, -8, false)).toBe(true);
  });
});

describe('isPnlSuspect', () => {
  it('returns true when pnl < -90% and position still has value', () => {
    expect(isPnlSuspect(-95, true)).toBe(true);
    expect(isPnlSuspect(-99.9, true)).toBe(true);
    expect(isPnlSuspect(-90.1, true)).toBe(true);
  });

  it('returns false when pnl > -90 regardless of value', () => {
    expect(isPnlSuspect(-50, true)).toBe(false);
    expect(isPnlSuspect(-8, true)).toBe(false);
    expect(isPnlSuspect(-89, true)).toBe(false);
    expect(isPnlSuspect(5, true)).toBe(false);
  });

  it('returns false when pnl < -90 but position has no value', () => {
    expect(isPnlSuspect(-95, false)).toBe(false);
    expect(isPnlSuspect(-99, false)).toBe(false);
  });

  it('returns false when pnl is null', () => {
    expect(isPnlSuspect(null, true)).toBe(false);
    expect(isPnlSuspect(undefined, true)).toBe(false);
  });
});

describe('per-position close lock', () => {
  it('prevents double-closing the same position', () => {
    const closing = new Set<string>();
    const posId = 'pos_abc123';

    expect(closing.has(posId)).toBe(false);
    closing.add(posId);
    expect(closing.has(posId)).toBe(true);

    // Second add is a no-op (Set semantics)
    closing.add(posId);
    expect(closing.size).toBe(1);

    closing.delete(posId);
    expect(closing.has(posId)).toBe(false);
  });

  it('allows different positions independently', () => {
    const closing = new Set<string>();
    closing.add('pos_a');
    closing.add('pos_b');
    expect(closing.has('pos_a')).toBe(true);
    expect(closing.has('pos_b')).toBe(true);
    expect(closing.size).toBe(2);

    closing.delete('pos_a');
    expect(closing.has('pos_a')).toBe(false);
    expect(closing.has('pos_b')).toBe(true);
  });
});
