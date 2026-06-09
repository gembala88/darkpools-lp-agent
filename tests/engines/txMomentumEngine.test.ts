import { describe, it, expect, beforeEach } from 'vitest';
import { TxMomentumEngine } from '../../src/engines/txMomentumEngine.js';
import { repositories } from '../../src/repositories/index.js';

describe('TxMomentumEngine', () => {
  let engine: TxMomentumEngine;

  beforeEach(() => {
    engine = new TxMomentumEngine();
  });

  it('should return bearish when no pool address provided', async () => {
    const result = await engine.evaluate({});
    expect(result.score).toBe(0);
    expect(result.signal).toBe('bearish');
  });

  it('should return a score for a pool with transactions', async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      await repositories.transaction.add({
        signature: `tx_momentum_test_${i}`,
        poolAddress: 'momentum_test_pool',
        tokenMint: 'momentum_test_token',
        type: i % 2 === 0 ? 'buy' : 'sell',
        amount: 100,
        volumeUsd: 1000,
        price: 1.0,
        walletAddress: `wallet_${i}`,
        timestamp: new Date(now - i * 10000),
        isSmartMoney: false,
        uniqueKey: `tx_momentum_test_${i}:${i % 2 === 0 ? 'buy' : 'sell'}`,
      });
    }

    const result = await engine.evaluate({ poolAddress: 'momentum_test_pool' });
    expect(result.score).toBeGreaterThan(0);
    expect(['bullish', 'neutral', 'bearish']).toContain(result.signal);
    expect(result.metadata).toHaveProperty('txVelocity');
  });
});
