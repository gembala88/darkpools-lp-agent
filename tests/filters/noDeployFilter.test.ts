import { describe, it, expect } from 'vitest';
import { NoDeployFilterV2, FilterCriteria } from '../../src/filters/noDeployFilterV2.js';

describe('NoDeployFilterV2', () => {
  const filter = new NoDeployFilterV2();

  const createCriteria = (overrides?: Partial<FilterCriteria>): FilterCriteria => ({
    lpAlphaScore: 85,
    confidence: 85,
    txMomentumScore: 70,
    feeVelocityScore: 70,
    holderGrowthScore: 60,
    liquidityStabilityScore: 70,
    smartMoneyScore: 60,
    buySellScore: 95,
    bundlerScore: 0.1,
    liquiditySuspicious: false,
    tokenAgeHours: 24,
    marketCap: 500000,
    ...overrides,
  });

  it('should pass for good criteria', () => {
    const result = filter.evaluate(createCriteria());
    expect(result.passed).toBe(true);
  });

  it('should reject when lpAlphaScore < 70', () => {
    const result = filter.evaluate(createCriteria({ lpAlphaScore: 60 }));
    expect(result.passed).toBe(false);
    expect(result.rejectReasons[0]).toContain('lpAlphaScore');
  });

  it('should reject when confidence < 75', () => {
    const result = filter.evaluate(createCriteria({ confidence: 70 }));
    expect(result.passed).toBe(false);
    expect(result.rejectReasons[0]).toContain('confidence');
  });

  it('should reject when txMomentumScore <= 0', () => {
    const result = filter.evaluate(createCriteria({ txMomentumScore: 0 }));
    expect(result.passed).toBe(false);
    expect(result.rejectReasons[0]).toContain('tx momentum');
  });

  it('should reject when feeVelocityScore <= 0', () => {
    const result = filter.evaluate(createCriteria({ feeVelocityScore: 0 }));
    expect(result.passed).toBe(false);
  });

  it('should reject when holderGrowthScore <= 0', () => {
    const result = filter.evaluate(createCriteria({ holderGrowthScore: 0 }));
    expect(result.passed).toBe(false);
  });

  it('should reject when liquidityStabilityScore <= 0', () => {
    const result = filter.evaluate(createCriteria({ liquidityStabilityScore: 0 }));
    expect(result.passed).toBe(false);
  });

  it('should reject when smartMoneyScore <= 0', () => {
    const result = filter.evaluate(createCriteria({ smartMoneyScore: 0 }));
    expect(result.passed).toBe(false);
  });

  it('should reject when buySellScore < 90', () => {
    const result = filter.evaluate(createCriteria({ buySellScore: 85 }));
    expect(result.passed).toBe(false);
    expect(result.rejectReasons[0]).toContain('buySellRatio');
  });

  it('should reject when bundlerScore > 0.3', () => {
    const result = filter.evaluate(createCriteria({ bundlerScore: 0.5 }));
    expect(result.passed).toBe(false);
  });

  it('should reject when liquidity suspicious', () => {
    const result = filter.evaluate(createCriteria({ liquiditySuspicious: true }));
    expect(result.passed).toBe(false);
  });

  it('should reject when tokenAgeHours < 2', () => {
    const result = filter.evaluate(createCriteria({ tokenAgeHours: 1 }));
    expect(result.passed).toBe(false);
  });

  it('should reject when marketCap < 100k', () => {
    const result = filter.evaluate(createCriteria({ marketCap: 50000 }));
    expect(result.passed).toBe(false);
  });

  it('should return warnings for borderline criteria', () => {
    const result = filter.evaluate(createCriteria({
      liquidityStabilityScore: 30,
      bundlerScore: 0.2,
    }));
    expect(result.passed).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.decision).toBe('WATCHLIST');
  });

  it('should aggregate multiple reject reasons', () => {
    const result = filter.evaluate(createCriteria({
      lpAlphaScore: 60,
      confidence: 60,
      txMomentumScore: 0,
      feeVelocityScore: 0,
    }));
    expect(result.passed).toBe(false);
    expect(result.rejectReasons.length).toBeGreaterThanOrEqual(3);
  });
});
