import { TokenRepository } from './tokenRepository.js';
import { HolderRepository } from './holderRepository.js';
import { LiquidityRepository } from './liquidityRepository.js';
import { MarketRepository } from './marketRepository.js';
import { TransactionRepository } from './transactionRepository.js';

export { TokenRepository } from './tokenRepository.js';
export { HolderRepository } from './holderRepository.js';
export { LiquidityRepository } from './liquidityRepository.js';
export { MarketRepository } from './marketRepository.js';
export { TransactionRepository } from './transactionRepository.js';
export { BaseRepository } from './baseRepository.js';

export const repositories = {
  token: new TokenRepository(),
  holder: new HolderRepository(),
  liquidity: new LiquidityRepository(),
  market: new MarketRepository(),
  transaction: new TransactionRepository(),
} as const;

export type Repositories = typeof repositories;
