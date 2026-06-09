export interface TelemetryEvent {
  type: string;
  timestamp: Date;
  duration: number;
  metadata: Record<string, unknown>;
}

export class TelemetryService {
  private events: TelemetryEvent[] = [];
  private maxEvents = 5000;
  private metrics: Map<string, number[]> = new Map();

  record(type: string, duration: number, metadata: Record<string, unknown> = {}): void {
    const event: TelemetryEvent = {
      type,
      timestamp: new Date(),
      duration,
      metadata,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    if (!this.metrics.has(type)) {
      this.metrics.set(type, []);
    }
    this.metrics.get(type)!.push(duration);
    if (this.metrics.get(type)!.length > 1000) {
      this.metrics.set(type, this.metrics.get(type)!.slice(-1000));
    }
  }

  getEvents(type?: string, limit = 100): TelemetryEvent[] {
    let filtered = this.events;
    if (type) filtered = filtered.filter(e => e.type === type);
    return filtered.slice(-limit);
  }

  getMetrics(type: string): {
    count: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p95Duration: number;
  } {
    const durations = this.metrics.get(type) ?? [];
    if (durations.length === 0) {
      return { count: 0, avgDuration: 0, minDuration: 0, maxDuration: 0, p95Duration: 0 };
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const sum = durations.reduce((s, d) => s + d, 0);

    return {
      count: durations.length,
      avgDuration: sum / durations.length,
      minDuration: sorted[0],
      maxDuration: sorted[sorted.length - 1],
      p95Duration: sorted[Math.floor(sorted.length * 0.95)],
    };
  }

  getSummary(): Record<string, {
    count: number;
    avgDuration: number;
    lastEvent: Date | null;
  }> {
    const summary: Record<string, {
      count: number;
      avgDuration: number;
      lastEvent: Date | null;
    }> = {};

    for (const [type, durations] of this.metrics.entries()) {
      const lastEvent = this.events.filter(e => e.type === type).pop();
      summary[type] = {
        count: durations.length,
        avgDuration: durations.reduce((s, d) => s + d, 0) / durations.length,
        lastEvent: lastEvent?.timestamp ?? null,
      };
    }

    return summary;
  }

  reset(): void {
    this.events = [];
    this.metrics.clear();
  }
}
