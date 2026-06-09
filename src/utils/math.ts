export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function weightedAverage(values: number[], weights: number[]): number {
  if (values.length !== weights.length) throw new Error('Values and weights must have same length');
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function exponentialMovingAverage(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(alpha * values[i] + (1 - alpha) * ema[i - 1]);
  }
  return ema;
}

export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function movingAverage(values: number[], window: number): number[] {
  if (values.length === 0 || window <= 0) return [];
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    result.push(slice.reduce((s, v) => s + v, 0) / slice.length);
  }
  return result;
}

export function calculateVelocity(values: number[], timeUnit: number): number[] {
  if (values.length < 2) return [0];
  const velocity: number[] = [0];
  for (let i = 1; i < values.length; i++) {
    velocity.push((values[i] - values[i - 1]) / timeUnit);
  }
  return velocity;
}

export function calculateAcceleration(values: number[], timeUnit: number): number[] {
  if (values.length < 3) return values.map(() => 0);
  const result: number[] = [0, 0];
  for (let i = 2; i < values.length; i++) {
    const v1 = (values[i - 1] - values[i - 2]) / timeUnit;
    const v2 = (values[i] - values[i - 1]) / timeUnit;
    result.push((v2 - v1) / timeUnit);
  }
  return result;
}

export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}
