import { describe, it, expect, beforeEach } from 'vitest';
import { HolderRepository } from '../../src/repositories/holderRepository.js';
import { HolderData } from '../../src/types/index.js';

describe('HolderRepository', () => {
  let repo: HolderRepository;

  beforeEach(() => {
    repo = new HolderRepository();
  });

  const createHolder = (overrides?: Partial<HolderData>): HolderData => ({
    address: 'wallet1',
    tokenMint: 'token1',
    balance: 1000,
    percentage: 1.0,
    firstSeen: new Date(),
    lastSeen: new Date(),
    transactionCount: 5,
    tags: [],
    ...overrides,
  });

  it('should upsert and retrieve a holder', async () => {
    const holder = createHolder();
    await repo.upsert(holder);
    const retrieved = await repo.getByAddress('wallet1', 'token1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.balance).toBe(1000);
  });

  it('should get holders by token', async () => {
    await repo.upsert(createHolder({ address: 'w1', balance: 100 }));
    await repo.upsert(createHolder({ address: 'w2', balance: 200 }));
    await repo.upsert(createHolder({ address: 'w3', balance: 300, tokenMint: 'token2' }));
    const holders = await repo.getByToken('token1');
    expect(holders.length).toBe(2);
  });

  it('should validate holder data', () => {
    const invalid = createHolder({ address: '' });
    const validation = repo.validate(invalid);
    expect(validation.valid).toBe(false);
  });

  it('should reject negative balance', () => {
    const invalid = createHolder({ balance: -1 });
    const validation = repo.validate(invalid);
    expect(validation.valid).toBe(false);
  });

  it('should reject invalid percentage', () => {
    const invalid = createHolder({ percentage: 150 });
    const validation = repo.validate(invalid);
    expect(validation.valid).toBe(false);
  });

  it('should get top holders', async () => {
    for (let i = 0; i < 15; i++) {
      await repo.upsert(createHolder({ address: `w${i}`, balance: 100 - i, percentage: 10 - i * 0.5 }));
    }
    const top = repo.getTopHolders('token1', 5);
    expect(top.length).toBe(5);
    expect(top[0].balance).toBe(100);
  });

  it('should calculate concentration', async () => {
    for (let i = 0; i < 10; i++) {
      await repo.upsert(createHolder({ address: `w${i}`, percentage: 10 }));
    }
    const concentration = repo.getConcentration('token1');
    expect(concentration).toBe(100);
  });
});
