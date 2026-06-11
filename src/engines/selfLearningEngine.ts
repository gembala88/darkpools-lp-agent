import { BaseEngine, EngineResult } from './baseEngine.js';
import type { MarketRegime } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

interface Outcome {
  poolAddress: string;
  tokenMint: string;
  score: number;
  actualProfit: number;
  marketRegime?: MarketRegime;
  narrative?: string;
  timestamp: number;
}

interface PatternInsight {
  scoreRange: [number, number];
  marketRegime?: MarketRegime;
  narrativeCategory?: string;
  winRate: number;
  avgProfit: number;
  sampleCount: number;
}

const DATA_FILE = path.resolve('data/patterns.json');

function loadPatterns(): Outcome[] {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    }
  } catch {}
  return [];
}

function savePatterns(outcomes: Outcome[]): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(outcomes, null, 2), 'utf-8');
  } catch {}
}

export class SelfLearningEngine extends BaseEngine {
  readonly name = 'self_learning';
  readonly version = '2.0.0';

  private outcomes: Outcome[];

  constructor() {
    super();
    this.outcomes = loadPatterns();
  }

  recordOutcome(poolAddress: string, tokenMint: string, score: number, actualProfit: number, marketRegime?: MarketRegime, narrative?: string): void {
    this.outcomes.push({ poolAddress, tokenMint, score, actualProfit, marketRegime, narrative, timestamp: Date.now() });
    if (this.outcomes.length > 1000) {
      this.outcomes = this.outcomes.slice(-1000);
    }
    savePatterns(this.outcomes);
  }

  async evaluate(params?: {
    poolAddress?: string;
    currentScore?: number;
    marketRegime?: MarketRegime;
    narrative?: string;
  }): Promise<EngineResult> {
    const poolAddress = params?.poolAddress ?? '';
    const currentScore = Number(params?.currentScore ?? 50);
    const marketRegime = params?.marketRegime as MarketRegime | undefined;
    const narrative = params?.narrative;

    const metadata: Record<string, unknown> = {
      sampleCount: this.outcomes.length,
    };

    if (this.outcomes.length < 5) {
      return {
        score: 50,
        signal: 'neutral',
        reason: `Insufficient data for learning (${this.outcomes.length} samples)`,
        metadata,
      };
    }

    const recent = this.outcomes.slice(-100);
    const avgProfit = recent.reduce((s, o) => s + o.actualProfit, 0) / recent.length;
    const sorted = [...recent].sort((a, b) => a.score - b.score);
    const medianScore = sorted[Math.floor(sorted.length / 2)].score;
    const winRate = recent.filter(o => o.actualProfit > 0).length / recent.length;

    const scoreCorrelation = this.calculateCorrelation(
      recent.map(o => o.score), recent.map(o => o.actualProfit)
    );

    let adjustment = 0;
    const signals: string[] = [];

    if (winRate > 0.6 && avgProfit > 0) {
      adjustment = 10;
      signals.push(`high win rate (${(winRate * 100).toFixed(0)}%)`);
    } else if (winRate < 0.4) {
      adjustment = -10;
      signals.push(`low win rate (${(winRate * 100).toFixed(0)}%)`);
    }

    if (scoreCorrelation > 0.3) {
      adjustment += 5;
      signals.push('score correlates with profit');
    } else if (scoreCorrelation < -0.2) {
      adjustment -= 5;
      signals.push('score inversely correlates with profit');
    }

    const regimeOutcomes = marketRegime ? recent.filter(o => o.marketRegime === marketRegime) : [];
    if (regimeOutcomes.length >= 3) {
      const regimeWinRate = regimeOutcomes.filter(o => o.actualProfit > 0).length / regimeOutcomes.length;
      if (regimeWinRate > 0.6) {
        adjustment += 5;
        signals.push(`strong history in ${marketRegime} (${(regimeWinRate * 100).toFixed(0)}%)`);
      } else if (regimeWinRate < 0.3) {
        adjustment -= 8;
        signals.push(`weak history in ${marketRegime} (${(regimeWinRate * 100).toFixed(0)}%)`);
      }
      metadata.regimeWinRate = Number(regimeWinRate.toFixed(2));
    }

    const recentOutcomes = this.outcomes.filter(o => (Date.now() - o.timestamp) < 86400000 * 7);
    if (recentOutcomes.length > 5) {
      const recentWinRate = recentOutcomes.filter(o => o.actualProfit > 0).length / recentOutcomes.length;
      if (recentWinRate < 0.3) {
        adjustment -= 5;
        signals.push('recent performance decline');
      }
    }

    const adjustedScore = this.normalizeScore(medianScore + adjustment);
    const recommendedThreshold = Math.max(50, Math.min(85, winRate > 0.5 ? 65 - adjustment : 70));

    metadata.winRate = Number(winRate.toFixed(2));
    metadata.avgProfit = Number(avgProfit.toFixed(4));
    metadata.scoreCorrelation = Number(scoreCorrelation.toFixed(3));
    metadata.adjustment = adjustment;
    metadata.recommendedScoreThreshold = recommendedThreshold;
    metadata.historicalPatternConfidence = Math.min(100, this.outcomes.length);

    return {
      score: adjustedScore,
      signal: adjustedScore >= 70 ? 'bullish' : adjustedScore < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'Insufficient learning patterns',
      metadata,
    };
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 3) return 0;
    const n = x.length;
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }
}
