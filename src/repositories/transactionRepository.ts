import { BaseRepository } from './baseRepository.js';
import { TransactionData, ValidationResult } from '../types/index.js';
import { Cache } from '../utils/cache.js';

export class TransactionRepository extends BaseRepository<TransactionData> {
  private transactions: TransactionData[] = [];
  private maxTransactions = 50000;
  private seenSignatures = new Set<string>();
  private listCache = new Cache<TransactionData[]>(10_000);

  async getBySignature(signature: string): Promise<TransactionData | null> {
    const cached = await this.getCached(`tx:${signature}`);
    if (cached) return cached;
    const tx = this.transactions.find(t => t.signature === signature) ?? null;
    if (tx) this.setCache(`tx:${signature}`, tx);
    return tx;
  }

  async getByPool(poolAddress: string, limit = 100, offset = 0): Promise<TransactionData[]> {
    const key = `txs:pool:${poolAddress}`;
    const cached = this.listCache.get(key);
    if (cached) return cached.slice(offset, offset + limit);
    const txs = this.transactions
      .filter(t => t.poolAddress === poolAddress)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    this.listCache.set(key, txs, 10_000);
    return txs.slice(offset, offset + limit);
  }

  async getByWallet(walletAddress: string, limit = 50): Promise<TransactionData[]> {
    return this.transactions
      .filter(t => t.walletAddress === walletAddress)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getByToken(tokenMint: string, limit = 100): Promise<TransactionData[]> {
    return this.transactions
      .filter(t => t.tokenMint === tokenMint)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getRecent(poolAddress: string, minutes: number): Promise<TransactionData[]> {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    return this.transactions.filter(t =>
      t.poolAddress === poolAddress && t.timestamp >= cutoff
    ).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async add(transaction: TransactionData): Promise<boolean> {
    if (this.seenSignatures.has(transaction.signature)) {
      return false;
    }
    if (this.isDuplicate(transaction)) {
      return false;
    }
    this.transactions.push(transaction);
    this.seenSignatures.add(transaction.signature);
    if (this.transactions.length > this.maxTransactions) {
      const removed = this.transactions.shift();
      if (removed) this.seenSignatures.delete(removed.signature);
    }
    this.invalidateCache(`tx:${transaction.signature}`);
    this.listCache.delete(`txs:pool:${transaction.poolAddress}`);
    return true;
  }

  async bulkAdd(transactions: TransactionData[]): Promise<number> {
    const deduped = this.deduplicate(transactions);
    let count = 0;
    for (const tx of deduped) {
      const validation = this.validate(tx);
      if (validation.valid) {
        const added = await this.add(tx);
        if (added) count++;
      }
    }
    return count;
  }

  getBuySellCount(poolAddress: string, minutes: number): { buys: number; sells: number } {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const relevant = this.transactions.filter(t =>
      t.poolAddress === poolAddress && t.timestamp >= cutoff
    );
    return {
      buys: relevant.filter(t => t.type === 'buy').length,
      sells: relevant.filter(t => t.type === 'sell').length,
    };
  }

  getSmartMoneyTransactions(poolAddress: string, minutes: number): TransactionData[] {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    return this.transactions.filter(t =>
      t.poolAddress === poolAddress &&
      t.timestamp >= cutoff &&
      t.isSmartMoney
    );
  }

  isDuplicate(transaction: TransactionData): boolean {
    return this.transactions.some(t =>
      t.uniqueKey === transaction.uniqueKey &&
      t.poolAddress === transaction.poolAddress
    );
  }

  validate(data: Partial<TransactionData>): ValidationResult {
    const errors: string[] = [];
    if (!data.signature) errors.push('signature is required');
    if (!data.poolAddress) errors.push('poolAddress is required');
    if (!data.tokenMint) errors.push('tokenMint is required');
    if (!data.type || !['buy', 'sell'].includes(data.type)) errors.push('type must be buy or sell');
    if (data.volumeUsd != null && data.volumeUsd < 0) errors.push('volumeUsd cannot be negative');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async refresh(key: string): Promise<TransactionData | null> {
    this.invalidateCache(`tx:${key}`);
    return this.getBySignature(key);
  }

  reconcile(remote: TransactionData, local: TransactionData): TransactionData {
    return { ...remote, signature: local.signature };
  }

  deduplicate(items: TransactionData[]): TransactionData[] {
    const seen = new Set<string>();
    return items.filter(item => {
      if (seen.has(item.signature)) return false;
      seen.add(item.signature);
      return true;
    });
  }

  getVolumeByType(poolAddress: string, minutes: number): { buyVolume: number; sellVolume: number } {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const relevant = this.transactions.filter(t =>
      t.poolAddress === poolAddress && t.timestamp >= cutoff
    );
    return {
      buyVolume: relevant.filter(t => t.type === 'buy').reduce((s, t) => s + t.volumeUsd, 0),
      sellVolume: relevant.filter(t => t.type === 'sell').reduce((s, t) => s + t.volumeUsd, 0),
    };
  }

  getUniqueTraders(poolAddress: string, minutes: number): number {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const wallets = new Set(
      this.transactions
        .filter(t => t.poolAddress === poolAddress && t.timestamp >= cutoff)
        .map(t => t.walletAddress)
    );
    return wallets.size;
  }

  clear(): void {
    this.transactions = [];
    this.seenSignatures.clear();
    this.cache.clear();
  }
}
