import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionRepository } from '../../src/repositories/transactionRepository.js';
import { TransactionData } from '../../src/types/index.js';

describe('TransactionRepository', () => {
  let repo: TransactionRepository;

  beforeEach(() => {
    repo = new TransactionRepository();
  });

  const createTx = (overrides?: Partial<TransactionData>): TransactionData => {
    const sig = overrides?.signature ?? 'sig1';
    const type = overrides?.type ?? 'buy';
    return {
      signature: sig,
      poolAddress: 'pool1',
      tokenMint: 'token1',
      type,
      amount: 100,
      volumeUsd: 1000,
      price: 1.0,
      walletAddress: 'wallet1',
      timestamp: new Date(),
      isSmartMoney: false,
      uniqueKey: `${sig}:${type}`,
      ...overrides,
    };
  };

  it('should add and retrieve a transaction', async () => {
    const tx = createTx();
    const added = await repo.add(tx);
    expect(added).toBe(true);
    const retrieved = await repo.getBySignature('sig1');
    expect(retrieved).not.toBeNull();
  });

  it('should reject duplicate transactions', async () => {
    const tx = createTx();
    await repo.add(tx);
    const added = await repo.add(tx);
    expect(added).toBe(false);
  });

  it('should get transactions by pool', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.add(createTx({ signature: `sig${i}`, poolAddress: 'pool1' }));
    }
    await repo.add(createTx({ signature: 'sig_other', poolAddress: 'pool2' }));
    const txs = await repo.getByPool('pool1', 10);
    expect(txs.length).toBe(5);
  });

  it('should get buy/sell counts', async () => {
    for (let i = 0; i < 3; i++) {
      await repo.add(createTx({ signature: `buy${i}`, type: 'buy' }));
    }
    for (let i = 0; i < 2; i++) {
      await repo.add(createTx({ signature: `sell${i}`, type: 'sell' }));
    }
    const counts = repo.getBuySellCount('pool1', 60);
    expect(counts.buys).toBe(3);
    expect(counts.sells).toBe(2);
  });

  it('should get volume by type', () => {
    const txs = [
      createTx({ signature: 's1', type: 'buy', volumeUsd: 100 }),
      createTx({ signature: 's2', type: 'buy', volumeUsd: 200 }),
      createTx({ signature: 's3', type: 'sell', volumeUsd: 50 }),
    ];
    txs.forEach(t => repo.add(t));
    const volumes = repo.getVolumeByType('pool1', 60);
    expect(volumes.buyVolume).toBe(300);
    expect(volumes.sellVolume).toBe(50);
  });

  it('should get unique traders', () => {
    const txs = [
      createTx({ signature: 's1', walletAddress: 'w1' }),
      createTx({ signature: 's2', walletAddress: 'w1' }),
      createTx({ signature: 's3', walletAddress: 'w2' }),
      createTx({ signature: 's4', walletAddress: 'w3' }),
    ];
    txs.forEach(t => repo.add(t));
    const traders = repo.getUniqueTraders('pool1', 60);
    expect(traders).toBe(3);
  });

  it('should get recent transactions', async () => {
    const txs = [
      createTx({ signature: 's1', timestamp: new Date() }),
      createTx({ signature: 's2', timestamp: new Date(Date.now() - 2 * 60_000) }),
      createTx({ signature: 's3', timestamp: new Date(Date.now() - 10 * 60_000) }),
    ];
    for (const tx of txs) await repo.add(tx);
    const recent = await repo.getRecent('pool1', 5);
    expect(recent.length).toBe(2);
  });

  it('should validate transaction data', () => {
    const invalid = createTx({ type: 'invalid' as 'buy' });
    const validation = repo.validate(invalid);
    expect(validation.valid).toBe(false);
  });

  it('should clear all transactions', async () => {
    await repo.add(createTx());
    repo.clear();
    expect(repo['transactions'].length).toBe(0);
  });
});
