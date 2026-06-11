import { BaseIntegration } from '../baseIntegration.js';

export interface MeteoraOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MeteoraVolumeHistory {
  timestamp: number;
  volume: number;
}

export interface MeteoraProtocolMetrics {
  totalTvl: number;
  totalVolume24h: number;
  totalFees24h: number;
  activePools: number;
  pairsCount: number;
}

export interface MeteoraPoolGroup {
  address: string;
  name: string;
  apr24h: number;
  apr7d: number;
  tvl: number;
  volume24h: number;
  fee24h: number;
  binStep: number;
}

export class MeteoraAnalyticsAdapter extends BaseIntegration {
  readonly name = 'meteora-analytics';

  constructor() {
    super({
      baseUrl: 'https://dlmm-api.meteora.ag',
      timeout: 10000,
      maxRetries: 2,
      rateLimit: 500,
    });
  }

  async getPoolOHLCV(address: string, timeframe = '5m', limit = 50): Promise<MeteoraOHLCV[]> {
    const data = await this.apiFetch<{ ohlcv: MeteoraOHLCV[] }>(
      `/pools/${address}/ohlcv`,
      { timeframe, limit }
    );
    return data?.ohlcv ?? [];
  }

  async getPoolVolumeHistory(address: string, timeframe = '5m', limit = 20): Promise<MeteoraVolumeHistory[]> {
    const data = await this.apiFetch<{ history: MeteoraVolumeHistory[] }>(
      `/pools/${address}/volume/history`,
      { timeframe, limit }
    );
    return data?.history ?? [];
  }

  async getProtocolMetrics(): Promise<MeteoraProtocolMetrics | null> {
    try {
      const data = await this.apiFetch<MeteoraProtocolMetrics>('/stats/protocol_metrics');
      return data;
    } catch {
      return null;
    }
  }

  async getPoolGroups(mintA: string, mintB: string): Promise<MeteoraPoolGroup[]> {
    const data = await this.apiFetch<{ groups: MeteoraPoolGroup[] }>(
      `/pools/groups/${mintA}_${mintB}`
    );
    return data?.groups ?? [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const metrics = await this.getProtocolMetrics();
      return metrics !== null && typeof metrics.activePools === 'number';
    } catch {
      return false;
    }
  }
}
