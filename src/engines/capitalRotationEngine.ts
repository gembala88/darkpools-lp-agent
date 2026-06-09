import { BaseEngine, EngineResult } from './baseEngine.js';

interface NarrativeVolume {
  narrative: string;
  volume24h: number;
  volumeChange: number;
  timestamp: Date;
}

export class CapitalRotationEngine extends BaseEngine {
  readonly name = 'capital_rotation';
  readonly version = '1.0.0';

  private narrativeVolumes: NarrativeVolume[] = [];

  async evaluate(params?: { tokenNarrative?: string; volume24h?: number }): Promise<EngineResult> {
    const { tokenNarrative, volume24h = 0 } = params ?? {};
    const metadata: Record<string, unknown> = {};

    if (tokenNarrative) {
      this.narrativeVolumes.push({
        narrative: tokenNarrative,
        volume24h,
        volumeChange: 0,
        timestamp: new Date(),
      });
      this.pruneOld();
    }

    const rotation = this.detectRotation();
    metadata.rotationDetected = rotation.detected;
    metadata.fromNarratives = rotation.from;
    metadata.toNarratives = rotation.to;

    if (!rotation.detected) {
      return { score: 50, signal: 'neutral', reason: 'No significant capital rotation detected', metadata };
    }

    const score = this.normalizeScore(Math.min(rotation.strength * 50, 100));
    return {
      score,
      signal: this.getSignal(score),
      reason: `rotation from [${rotation.from.join(', ')}] to [${rotation.to.join(', ')}]`,
      metadata,
    };
  }

  private detectRotation(): {
    detected: boolean;
    from: string[];
    to: string[];
    strength: number;
  } {
    const now = Date.now();
    const recent = this.narrativeVolumes.filter(v => now - v.timestamp.getTime() < 3600 * 1000);
    const older = this.narrativeVolumes.filter(v => now - v.timestamp.getTime() >= 3600 * 1000);

    if (recent.length < 3 || older.length < 3) {
      return { detected: false, from: [], to: [], strength: 0 };
    }

    const recentByNarrative = this.groupByNarrative(recent);
    const olderByNarrative = this.groupByNarrative(older);

    const declining: string[] = [];
    const rising: string[] = [];
    let totalStrength = 0;

    for (const [narrative, recentVol] of Object.entries(recentByNarrative)) {
      const olderVol = olderByNarrative[narrative] ?? 0;
      if (olderVol > 0) {
        const change = ((recentVol - olderVol) / olderVol) * 100;
        if (change < -20) {
          declining.push(narrative);
          totalStrength += Math.abs(change);
        } else if (change > 20) {
          rising.push(narrative);
          totalStrength += change;
        }
      }
    }

    return {
      detected: declining.length > 0 || rising.length > 0,
      from: declining,
      to: rising,
      strength: totalStrength / 100,
    };
  }

  private groupByNarrative(volumes: NarrativeVolume[]): Record<string, number> {
    const grouped: Record<string, number> = {};
    for (const v of volumes) {
      grouped[v.narrative] = (grouped[v.narrative] ?? 0) + v.volume24h;
    }
    return grouped;
  }

  private pruneOld(): void {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    this.narrativeVolumes = this.narrativeVolumes.filter(v => v.timestamp.getTime() >= cutoff);
  }
}
