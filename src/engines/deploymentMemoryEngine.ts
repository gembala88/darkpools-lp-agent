import { BaseEngine, EngineResult } from './baseEngine.js';
import type { DeployRecord, PatternRecord, MarketRegime } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

function getDataFile(): string {
  return process.env.DRY_RUN === 'true'
    ? path.resolve('data/dry-run-deployment-memory.json')
    : path.resolve('data/live-deployment-memory.json');
}

function loadDeployHistory(): DeployRecord[] {
  try {
    const dataFile = getDataFile();
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    }
    // Migration: old unified file exists but mode-specific file does not
    const oldFile = path.resolve('data/deployment-memory.json');
    if (fs.existsSync(oldFile) && !fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(oldFile, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        const dir = path.dirname(dataFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8');
        return data;
      }
    }
  } catch {}
  return [];
}

function saveDeployHistory(history: DeployRecord[]): void {
  try {
    const dataFile = getDataFile();
    const dir = path.dirname(dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(history, null, 2), 'utf-8');
  } catch {}
}

export class DeploymentMemoryEngine extends BaseEngine {
  readonly name = 'deployment_memory';
  readonly version = '2.0.0';

  private deployHistory: DeployRecord[];
  private patterns: PatternRecord[];

  constructor() {
    super();
    this.deployHistory = loadDeployHistory();
    this.patterns = [];
    if (this.deployHistory.length >= 5) this.updatePatterns();
  }

  recordDeployment(record: DeployRecord): void {
    this.deployHistory.push(record);
    if (this.deployHistory.length > 1000) {
      this.deployHistory = this.deployHistory.slice(-1000);
    }
    saveDeployHistory(this.deployHistory);
    if (this.deployHistory.length >= 5) this.updatePatterns();
  }

  getHistory(): DeployRecord[] {
    return this.deployHistory;
  }

  async evaluate(params?: {
    poolAddress?: string;
    currentScore?: number;
    marketRegime?: MarketRegime;
    tokenMint?: string;
  }): Promise<EngineResult> {
    const currentScore = Number(params?.currentScore ?? 50);
    const marketRegime = (params?.marketRegime ?? 'RANGING') as MarketRegime;
    const poolAddress = params?.poolAddress ?? '';

    const metadata: Record<string, unknown> = {
      totalDeployments: this.deployHistory.length,
    };

    if (this.deployHistory.length < 3) {
      return {
        score: currentScore,
        signal: 'neutral',
        reason: `Insufficient deployment history (${this.deployHistory.length})`,
        metadata,
      };
    }

    const relevantPattern = this.patterns.find(p =>
      p.conditions.marketRegime === marketRegime &&
      currentScore >= p.conditions.lpAlphaScoreRange[0] &&
      currentScore <= p.conditions.lpAlphaScoreRange[1]
    );

    if (!relevantPattern) {
      return {
        score: currentScore,
        signal: 'neutral',
        reason: 'No matching historical pattern found',
        metadata: { ...metadata, matchedPatterns: 0 },
      };
    }

    const { successRate, avgProfit, sampleCount } = relevantPattern.outcomes;
    let adjustment = 0;
    const signals: string[] = [];

    if (successRate > 0.7 && avgProfit > 0) {
      adjustment = 10;
      signals.push(`historical success rate ${(successRate * 100).toFixed(0)}% in ${marketRegime}`);
    } else if (successRate > 0.5) {
      adjustment = 5;
      signals.push(`moderate historical success in ${marketRegime}`);
    } else if (successRate < 0.3) {
      adjustment = -15;
      signals.push(`poor historical performance in ${marketRegime} regime`);
    }

    const recentDeploys = this.deployHistory.filter(d => {
      const ts = typeof d.timestamp === 'string' ? new Date(d.timestamp).getTime() : Number(d.timestamp);
      return (Date.now() - ts) < 86400000;
    });

    if (recentDeploys.length > 5) {
      const recentWins = recentDeploys.filter(d => d.profit > 0).length;
      const recentWinRate = recentWins / recentDeploys.length;
      if (recentWinRate < 0.3) {
        adjustment -= 10;
        signals.push('cooldown: recent poor performance');
      }
    }

    const adjustedScore = this.normalizeScore(currentScore + adjustment);

    return {
      score: adjustedScore,
      signal: adjustedScore >= 70 ? 'bullish' : adjustedScore < 40 ? 'bearish' : 'neutral',
      reason: signals.join('; ') || 'No significant historical pattern',
      metadata: {
        ...metadata,
        matchedPatterns: 1,
        successRate: Number(successRate.toFixed(2)),
        avgProfit: Number(avgProfit.toFixed(4)),
        sampleCount,
        recentDeployments24h: recentDeploys.length,
        adjustment,
      },
    };
  }

  private updatePatterns(): void {
    if (this.deployHistory.length < 5) return;
    this.patterns = [];
    const regimes = [...new Set(this.deployHistory.map(d => d.marketRegime))];
    for (const regime of regimes) {
      const regimeDeploys = this.deployHistory.filter(d => d.marketRegime === regime);
      if (regimeDeploys.length < 3) continue;
      const scoreRanges: [number, number][] = [[0, 30], [30, 50], [50, 70], [70, 85], [85, 100]];
      for (const [min, max] of scoreRanges) {
        const matched = regimeDeploys.filter(d => d.lpAlphaScore >= min && d.lpAlphaScore <= max);
        if (matched.length < 2) continue;
        const profits = matched.map(d => d.profit);
        const avgProfit = profits.reduce((s, p) => s + p, 0) / profits.length;
        const avgApr = matched.reduce((s, d) => s + d.apr, 0) / matched.length;
        const successRate = matched.filter(d => d.profit > 0).length / matched.length;
        this.patterns.push({
          conditions: { marketRegime: regime, lpAlphaScoreRange: [min, max], momentumScoreRange: [0, 100] },
          outcomes: { avgProfit, avgApr, successRate, sampleCount: matched.length },
        });
      }
    }
  }
}
