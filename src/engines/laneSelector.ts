import { BaseEngine, EngineResult } from './baseEngine.js';
import type { LaneName } from '../types/index.js';

export interface LaneConfig {
  label: string;
  minLpAlphaScore: number;
  screeningOverrides: Record<string, number | boolean | string>;
  maxPositions: number;
  deployAmountSol: number;
  sizingMultiplier: number;
}

export interface LaneSelectorContext {
  recentWinRate?: number;
  recentDeployCount?: number;
  marketRegime?: string;
  volatilityTrend?: string;
  psychology?: string;
  dryRun?: boolean;
}

export class LaneSelector extends BaseEngine {
  readonly name = 'lane_selector';
  readonly version = '1.0.0';

  private readonly laneDefaults: Record<LaneName, LaneConfig> = {
    institutional: {
      label: 'Institutional',
      minLpAlphaScore: 75,
      screeningOverrides: {},
      maxPositions: 2,
      deployAmountSol: 0.3,
      sizingMultiplier: 0.8,
    },
    balanced: {
      label: 'Balanced',
      minLpAlphaScore: 70,
      screeningOverrides: {},
      maxPositions: 3,
      deployAmountSol: 0.5,
      sizingMultiplier: 1.0,
    },
    moonshot: {
      label: 'Moonshot',
      minLpAlphaScore: 60,
      screeningOverrides: {},
      maxPositions: 4,
      deployAmountSol: 0.7,
      sizingMultiplier: 1.3,
    },
  };

  private userLanes: Partial<Record<LaneName, Partial<LaneConfig>>> = {};

  setUserLanes(lanes: Partial<Record<LaneName, Partial<LaneConfig>>>): void {
    this.userLanes = lanes;
  }

  getLaneConfig(lane: LaneName): LaneConfig {
    const user = this.userLanes[lane] ?? {};
    const defaults = this.laneDefaults[lane];
    return {
      label: user.label ?? defaults.label,
      minLpAlphaScore: user.minLpAlphaScore ?? defaults.minLpAlphaScore,
      screeningOverrides: { ...defaults.screeningOverrides, ...user.screeningOverrides },
      maxPositions: user.maxPositions ?? defaults.maxPositions,
      deployAmountSol: user.deployAmountSol ?? defaults.deployAmountSol,
      sizingMultiplier: user.sizingMultiplier ?? defaults.sizingMultiplier,
    };
  }

  getAllLaneConfigs(): Record<LaneName, LaneConfig> {
    return {
      institutional: this.getLaneConfig('institutional'),
      balanced: this.getLaneConfig('balanced'),
      moonshot: this.getLaneConfig('moonshot'),
    };
  }

  selectLane(context: LaneSelectorContext): LaneName {
    if (context.dryRun) return 'moonshot';
    const regime = context.marketRegime ?? 'RANGING';
    const winRate = context.recentWinRate;
    const deploys24h = context.recentDeployCount ?? 0;
    const psych = context.psychology ?? 'NEUTRAL';
    const volTrend = context.volatilityTrend ?? '';

    const bullishRegimes = ['ACCUMULATION', 'TRENDING_BULLISH', 'EUPHORIA'];
    const bearishRegimes = ['TRENDING_BEARISH', 'DISTRIBUTION', 'PANIC'];
    const greedyPsychology = ['GREED', 'EUPHORIA'];

    if (bullishRegimes.includes(regime) && !bearishRegimes.includes(regime) && winRate != null && winRate > 0.6) {
      return 'moonshot';
    }

    if (greedyPsychology.includes(psych) && volTrend !== 'decreasing' && (winRate == null || winRate > 0.5)) {
      return 'moonshot';
    }

    if (bearishRegimes.includes(regime)) {
      return 'institutional';
    }

    if (winRate != null && winRate < 0.3 && deploys24h > 3) {
      return 'institutional';
    }

    return 'balanced';
  }

  async evaluate(params?: Record<string, unknown>): Promise<EngineResult> {
    const context: LaneSelectorContext = {
      recentWinRate: params?.recentWinRate as number | undefined,
      recentDeployCount: params?.recentDeployCount as number | undefined,
      marketRegime: params?.marketRegime as string | undefined,
      volatilityTrend: params?.volatilityTrend as string | undefined,
      psychology: params?.psychology as string | undefined,
      dryRun: params?.dryRun as boolean | undefined,
    };

    const lane = this.selectLane(context);
    const config = this.getLaneConfig(lane);

    return {
      score: config.minLpAlphaScore,
      signal: 'neutral',
      reason: `Auto-selected lane: ${config.label} (minAlpha=${config.minLpAlphaScore}, maxPos=${config.maxPositions})`,
      metadata: {
        lane,
        laneConfig: config,
        context,
      },
    };
  }
}
