export interface EngineConfig {
  name: string;
  version: string;
  enabled: boolean;
}

export interface EngineResult {
  score: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  reason: string;
  metadata: Record<string, unknown>;
}

export abstract class BaseEngine<TConfig extends EngineConfig = EngineConfig> {
  abstract readonly name: string;
  abstract readonly version: string;

  protected config: TConfig;

  constructor(config?: Partial<TConfig>) {
    this.config = {
      name: this.constructor.name,
      version: '1.0.0',
      enabled: true,
      ...config,
    } as TConfig;
  }

  abstract evaluate(params?: Record<string, unknown>): Promise<EngineResult>;

  protected normalizeScore(raw: number, min = 0, max = 100): number {
    return Math.max(min, Math.min(max, raw));
  }

  protected getSignal(score: number): 'bullish' | 'bearish' | 'neutral' {
    if (score >= 70) return 'bullish';
    if (score < 40) return 'bearish';
    return 'neutral';
  }

  protected calculateTrend(current: number, previous: number): 'up' | 'down' | 'stable' {
    if (previous === 0) return 'stable';
    const change = ((current - previous) / previous) * 100;
    if (change > 5) return 'up';
    if (change < -5) return 'down';
    return 'stable';
  }

  protected calculateAcceleration(values: number[]): number {
    if (values.length < 3) return 0;
    const deltas: number[] = [];
    for (let i = 1; i < values.length; i++) {
      deltas.push(values[i] - values[i - 1]);
    }
    const avgDelta = deltas.reduce((s: number, d: number) => s + d, 0) / deltas.length;
    if (deltas.length > 1) {
      const lastDelta = deltas[deltas.length - 1];
      return lastDelta - avgDelta;
    }
    return avgDelta;
  }
}
