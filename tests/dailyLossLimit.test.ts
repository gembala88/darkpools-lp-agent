import { describe, it, expect } from 'vitest';
import { shouldPauseDailyLoss, isCooldownExpired, resolveSolPrice } from '../tools/executor.js';

describe('shouldPauseDailyLoss', () => {
  it('returns false when realizedPnlSol is positive (net profit)', () => {
    expect(shouldPauseDailyLoss(0.5, 0.1)).toBe(false);
    expect(shouldPauseDailyLoss(0.013, 0.1)).toBe(false);
  });

  it('returns false when realizedPnlSol is negative but within limit', () => {
    expect(shouldPauseDailyLoss(-0.05, 0.1)).toBe(false);
    expect(shouldPauseDailyLoss(-0.089, 0.1)).toBe(false);
    expect(shouldPauseDailyLoss(-0.099, 0.1)).toBe(false);
  });

  it('returns true when net loss equals or exceeds limit', () => {
    expect(shouldPauseDailyLoss(-0.1, 0.1)).toBe(true);
    expect(shouldPauseDailyLoss(-0.15, 0.1)).toBe(true);
    expect(shouldPauseDailyLoss(-0.5, 0.1)).toBe(true);
  });

  it('returns false when limit is null or zero', () => {
    expect(shouldPauseDailyLoss(-0.5, null)).toBe(false);
    expect(shouldPauseDailyLoss(-0.5, undefined)).toBe(false);
    expect(shouldPauseDailyLoss(-0.5, 0)).toBe(false);
  });

  it('net-positive day with one big loss does NOT trigger', () => {
    const trades = [0.15, -0.089, 0.05, -0.02, 0.03];
    const realizedPnlSol = trades.reduce((a, b) => a + b, 0);
    expect(realizedPnlSol).toBeCloseTo(0.121);
    expect(shouldPauseDailyLoss(realizedPnlSol, 0.1)).toBe(false);
  });

  it('net loss day exceeding limit DOES trigger', () => {
    const trades = [-0.15, 0.02, -0.02];
    const realizedPnlSol = trades.reduce((a, b) => a + b, 0);
    expect(realizedPnlSol).toBeCloseTo(-0.15);
    expect(shouldPauseDailyLoss(realizedPnlSol, 0.1)).toBe(true);
  });
});

describe('isCooldownExpired', () => {
  it('returns false when pausedUntil is null/undefined', () => {
    expect(isCooldownExpired(null)).toBe(false);
    expect(isCooldownExpired(undefined)).toBe(false);
  });

  it('returns false when now is before pausedUntil', () => {
    const future = Date.now() + 3600_000;
    expect(isCooldownExpired(future, Date.now())).toBe(false);
  });

  it('returns true when now equals pausedUntil', () => {
    const now = 1_000_000_000;
    expect(isCooldownExpired(now, now)).toBe(true);
  });

  it('returns true when now is after pausedUntil', () => {
    const past = Date.now() - 1000;
    expect(isCooldownExpired(past, Date.now())).toBe(true);
  });
});

describe('resolveSolPrice', () => {
  it('uses the first successful fetcher', async () => {
    const jupiter = async () => 175.42;
    const wallet = async () => 170.0;
    const result = await resolveSolPrice([jupiter, wallet]);
    expect(result.price).toBe(175.42);
    expect(result.source).toBe('jupiter');
  });

  it('falls back to second fetcher when first fails', async () => {
    const failing = async () => { throw new Error('network error'); };
    const wallet = async () => 170.0;
    const result = await resolveSolPrice([failing, wallet]);
    expect(result.price).toBe(170.0);
    expect(result.source).toBe('wallet');
  });

  it('falls back to hardcoded 150 when all fetchers fail', async () => {
    const fail1 = async () => { throw new Error('timeout'); };
    const fail2 = async () => { throw new Error('parse error'); };
    const result = await resolveSolPrice([fail1, fail2]);
    expect(result.price).toBe(150);
    expect(result.source).toBe('fallback(150)');
  });

  it('skips fetchers that return 0 or negative', async () => {
    const zero = async () => 0;
    const negative = async () => -5;
    const good = async () => 100;
    const result = await resolveSolPrice([zero, negative, good]);
    expect(result.price).toBe(100);
    expect(result.source).toBe('good');
  });

  it('never returns 0 for price (no divide-by-zero risk)', async () => {
    const fail = async () => { throw new Error('fail'); };
    const result = await resolveSolPrice([fail]);
    expect(result.price).toBe(150);
    expect(result.price).toBeGreaterThan(0);
  });

  it('handles empty fetchers array', async () => {
    const result = await resolveSolPrice([]);
    expect(result.price).toBe(150);
    expect(result.source).toBe('fallback(150)');
  });
});
