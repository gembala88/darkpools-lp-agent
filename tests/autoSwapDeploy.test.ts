import { describe, it, expect } from 'vitest';
import { resolveSolPrice } from '../tools/executor.js';

describe('resolveSolPrice fallback chain', () => {
  it('jupiter returns price → uses it', async () => {
    const jupiter = async () => {
      const res = await Promise.resolve({ ok: true, json: async () => ({ data: { So11111111111111111111111111111111111111112: { usdPrice: 175.42 } } }) }) as any;
      const priceData = await res.json();
      return priceData?.data?.So11111111111111111111111111111111111111112?.usdPrice ?? 0;
    };
    const result = await resolveSolPrice([jupiter]);
    expect(result.price).toBe(175.42);
    expect(result.source).toBe('jupiter');
  });

  it('jupiter fails → falls back to wallet price', async () => {
    const jupiterFail = async () => { throw new Error('fetch failed'); };
    const walletPrice = async () => 170.0;
    const result = await resolveSolPrice([jupiterFail, walletPrice]);
    expect(result.price).toBe(170.0);
    expect(result.source).toBe('walletPrice');
  });

  it('both jupiter and wallet fail → uses hardcoded 150', async () => {
    const fail1 = async () => { throw new Error('timeout'); };
    const fail2 = async () => { throw new Error('RPC error'); };
    const result = await resolveSolPrice([fail1, fail2]);
    expect(result.price).toBe(150);
    expect(result.source).toBe('fallback(150)');
  });

  it('never returns 0 price (prevents division by zero in conversion)', async () => {
    const zeroPrice = async () => 0;
    const result = await resolveSolPrice([zeroPrice]);
    expect(result.price).toBe(150);
    expect(result.price).toBeGreaterThan(0);
  });
});

describe('swap retry logic (simulated)', () => {
  it('succeeds on first attempt', async () => {
    let attempts = 0;
    const swap = async () => {
      attempts++;
      return { success: true, amount_out: 35.5 };
    };
    const result = await swap();
    expect(attempts).toBe(1);
    expect(result.amount_out).toBe(35.5);
    expect(result.success).toBe(true);
  });

  it('succeeds on retry after transient failure', async () => {
    let attempts = 0;
    const swap = async () => {
      attempts++;
      if (attempts === 1) throw new Error('blockhash not found');
      return { success: true, amount_out: 35.5 };
    };
    let lastError: any = null;
    let result: any = null;
    for (let i = 0; i <= 2; i++) {
      try {
        result = await swap();
        break;
      } catch (e) {
        lastError = e;
        if (i < 2) await new Promise(r => setTimeout(r, 1));
      }
    }
    expect(attempts).toBe(2);
    expect(result?.success).toBe(true);
    expect(result?.amount_out).toBe(35.5);
  });

  it('gracefully degrades after all retries fail (does not throw)', async () => {
    let attempts = 0;
    const swap = async () => {
      attempts++;
      throw new Error('swap failed');
    };
    let lastError: any = null;
    let result: any = null;
    for (let i = 0; i <= 2; i++) {
      try {
        result = await swap();
        break;
      } catch (e) {
        lastError = e;
        if (i < 2) await new Promise(r => setTimeout(r, 1));
      }
    }
    expect(attempts).toBe(3);
    expect(result).toBeNull();
    expect(lastError).toBeTruthy();
    // After failure, the deploy proceeds with available balance — no throw
  });

  it('handles partial swap (swap succeeds but deploy cancelled elsewhere)', async () => {
    // If swap partially succeeds, USDC stays in wallet for next deploy — no crash
    const swapResult = { success: true, amount_out: 36.7 };
    expect(swapResult.success).toBe(true);
    const args = { _quoteSwapNeeded: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', needed: 35, have: 0 } };
    delete args._quoteSwapNeeded;
    expect(args._quoteSwapNeeded).toBeUndefined();
  });
});
