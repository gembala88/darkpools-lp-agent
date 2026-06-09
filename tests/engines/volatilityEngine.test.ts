import { describe, it, expect } from 'vitest';
import { VolatilityEngine } from '../../src/engines/volatilityEngine.js';

describe('VolatilityEngine', () => {
  const engine = new VolatilityEngine();

  it('should return bearish for no data', async () => {
    const result = await engine.evaluate({});
    expect(result.score).toBe(0);
    expect(result.signal).toBe('bearish');
  });

  it('should reject dead volatility', async () => {
    const result = await engine.evaluate({ priceChanges: [0, 0.01, 0.02, 0.01] });
    expect(result.score).toBe(0);
    expect(result.signal).toBe('bearish');
  });

  it('should accept healthy volatility', async () => {
    const result = await engine.evaluate({ priceChanges: [1, -0.5, 0.8, -1.2, 0.6, -0.9, 1.5, -1.0] });
    expect(result.score).toBeGreaterThan(50);
    expect(result.signal).toBe('bullish');
  });

  it('should reject extreme volatility', async () => {
    const result = await engine.evaluate({ priceChanges: [10, -15, 20, -25, 30] });
    expect(result.score).toBe(0);
    expect(result.signal).toBe('bearish');
  });

  it('should use explicit volatility score', async () => {
    const result = await engine.evaluate({ volatilityScore: 1.5 });
    expect(result.score).toBeGreaterThan(50);
    expect((result.metadata as Record<string, unknown>).category).toBe('Healthy');
  });
});
