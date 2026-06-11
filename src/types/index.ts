export interface TokenData {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: number;
  price: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  holders: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HolderData {
  address: string;
  tokenMint: string;
  balance: number;
  percentage: number;
  firstSeen: Date;
  lastSeen: Date;
  transactionCount: number;
  tags: string[];
}

export interface LiquiditySnapshot {
  poolAddress: string;
  tokenMint: string;
  liquidity: number;
  tvl: number;
  activeBinLiquidity: number;
  timestamp: Date;
  source: string;
}

export interface MarketData {
  poolAddress: string;
  tokenMint: string;
  price: number;
  volume5m: number;
  volume15m: number;
  volume30m: number;
  volume1h: number;
  volume24h: number;
  txCount5m: number;
  txCount15m: number;
  txCount30m: number;
  txCount1h: number;
  buyVolume5m: number;
  sellVolume5m: number;
  buyCount5m: number;
  sellCount5m: number;
  uniqueTraders5m: number;
  uniqueTraders15m: number;
  uniqueTraders1h: number;
  uniqueTraders4h: number;
  timestamp: Date;
}

export interface TransactionData {
  signature: string;
  poolAddress: string;
  tokenMint: string;
  type: 'buy' | 'sell';
  amount: number;
  volumeUsd: number;
  price: number;
  walletAddress: string;
  timestamp: Date;
  isSmartMoney: boolean;
  uniqueKey: string;
}

export interface FeeData {
  poolAddress: string;
  tokenMint: string;
  fee5m: number;
  fee15m: number;
  fee30m: number;
  fee1h: number;
  fee24h: number;
  feePerTvl24h: number;
  apr24h: number;
  apr7d: number;
  timestamp: Date;
}

export interface PoolMetrics {
  poolAddress: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  binStep: number;
  baseFee: number;
  activeBin: number;
  price: number;
  liquidity: number;
  tvl: number;
  volume24h: number;
  fee24h: number;
  feePerTvl24h: number;
  apr24h: number;
  holders: number;
  marketCap: number;
  volatility: string;
  organicScore: number;
  timestamp: Date;
}

export interface EngineResult {
  score: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  reason: string;
  metadata: Record<string, unknown>;
}

export interface RepositoryCacheEntry<T> {
  data: T;
  fetchedAt: Date;
  ttl: number;
}

export interface RepositoryConfig {
  defaultTTL: number;
  maxRetries: number;
  enableCache: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type MarketRegime =
  | 'ACCUMULATION'
  | 'TRENDING_BULLISH'
  | 'TRENDING_BEARISH'
  | 'RANGING'
  | 'DISTRIBUTION'
  | 'PANIC'
  | 'EUPHORIA';

export type PoolActivityLevel = 'DEAD' | 'LOW' | 'NORMAL' | 'ACTIVE' | 'VERY_ACTIVE';

export type TrendState = 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';

export type MarketPsychology = 'FEAR' | 'NEUTRAL' | 'GREED' | 'EUPHORIA' | 'CAPITULATION';

export type LaneName = 'institutional' | 'balanced' | 'moonshot';

export interface DeployRecord {
  poolAddress: string;
  tokenMint: string;
  lpAlphaScore: number;
  momentumScore: number;
  marketRegime: MarketRegime;
  deploymentDecision: string;
  profit: number;
  loss: number;
  apr: number;
  feeGenerated: number;
  lane?: LaneName;
  timestamp: Date;
}

export interface PatternRecord {
  conditions: {
    marketRegime: MarketRegime;
    lpAlphaScoreRange: [number, number];
    momentumScoreRange: [number, number];
  };
  outcomes: {
    avgProfit: number;
    avgApr: number;
    successRate: number;
    sampleCount: number;
  };
}

export interface AgentOpinion {
  agent: string;
  score: number;
  confidence: number;
  reasoning: string;
}
