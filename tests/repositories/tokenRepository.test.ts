import { describe, it, expect, beforeEach } from 'vitest';
import { TokenRepository } from '../../src/repositories/tokenRepository.js';
import { TokenData } from '../../src/types/index.js';

describe('TokenRepository', () => {
  let repo: TokenRepository;

  beforeEach(() => {
    repo = new TokenRepository();
  });

  const createToken = (overrides?: Partial<TokenData>): TokenData => ({
    mint: 'test_mint',
    symbol: 'TEST',
    name: 'Test Token',
    decimals: 6,
    supply: 1000000,
    price: 1.0,
    marketCap: 1000000,
    liquidity: 500000,
    volume24h: 100000,
    holders: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('should upsert and retrieve a token', async () => {
    const token = createToken();
    await repo.upsert(token);
    const retrieved = await repo.getByMint('test_mint');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.symbol).toBe('TEST');
  });

  it('should reject invalid token data', () => {
    const invalid = createToken({ liquidity: -1 });
    const validation = repo.validate(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it('should deduplicate tokens', () => {
    const tokens = [
      createToken({ mint: 'mint1' }),
      createToken({ mint: 'mint1' }),
      createToken({ mint: 'mint2' }),
    ];
    const deduped = repo.deduplicate(tokens);
    expect(deduped.length).toBe(2);
  });

  it('should reconcile remote and local data', async () => {
    const local = createToken({ price: 1.0, holders: 100 });
    const remote = createToken({ price: 1.5, holders: 150 });
    const reconciled = repo.reconcile(remote, local);
    expect(reconciled.price).toBe(1.5);
    expect(reconciled.holders).toBe(150);
    expect(reconciled.mint).toBe('test_mint');
  });

  it('should handle bulk upsert', async () => {
    const tokens = [
      createToken({ mint: 'mint1' }),
      createToken({ mint: 'mint2' }),
      createToken({ mint: 'mint3' }),
    ];
    const count = await repo.bulkUpsert(tokens);
    expect(count).toBe(3);
    const all = await repo.getAll();
    expect(all.length).toBe(3);
  });

  it('should reject token with zero liquidity', () => {
    const invalid = createToken({ liquidity: 0 });
    const validation = repo.validate(invalid);
    expect(validation.valid).toBe(false);
  });

  it('should reject token with zero marketCap', () => {
    const invalid = createToken({ marketCap: 0 });
    const validation = repo.validate(invalid);
    expect(validation.valid).toBe(false);
  });

  it('should delete a token', async () => {
    const token = createToken();
    await repo.upsert(token);
    const deleted = await repo.delete('test_mint');
    expect(deleted).toBe(true);
    const retrieved = await repo.getByMint('test_mint');
    expect(retrieved).toBeNull();
  });
});
