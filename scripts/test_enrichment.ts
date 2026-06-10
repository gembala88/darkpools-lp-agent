import { integrations } from '../src/integrations/index.js';
import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'fs';

dotenvConfig();

const DIVIDER = '='.repeat(90);
const MINT = 'So11111111111111111111111111111111111111112';

function loadEnv(): { birdeyeKey: string | undefined } {
  let k = process.env.BIRDEYE_API_KEY;
  if (!k && existsSync('.env')) {
    const m = readFileSync('.env', 'utf-8').match(/^BIRDEYE_API_KEY=(.+)$/m);
    if (m) k = m[1].trim();
  }
  return { birdeyeKey: k };
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error?: string }> {
  try { const v = await fn(); return { ok: true, value: v }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

async function main() {
  const { birdeyeKey } = loadEnv();

  console.log(DIVIDER);
  console.log('PHASE 70 — ENRICHMENT VALIDATION');
  console.log(`Mint: ${MINT}`);
  console.log(`BIRDEYE_API_KEY: ${birdeyeKey ? `present (${birdeyeKey.slice(0, 8)}...)` : 'NOT FOUND'}`);
  console.log(DIVIDER);

  // ── Birdeye ──
  console.log('\n── BIRDEYE ──');
  const bOverview = await safe('birdeye.getTokenOverview', () => integrations.birdeye.getTokenOverview(MINT));
  if (bOverview.ok && bOverview.value) {
    const v = bOverview.value as any;
    console.log(`  holders:     ${v.holders ?? '❌ undefined'}`);
    console.log(`  marketCap:   ${v.marketCap ?? '❌ undefined'}`);
    console.log(`  liquidity:   ${v.liquidity ?? '❌ undefined'}`);
    console.log(`  price:       ${v.price ?? '❌ undefined'}`);
    console.log(`  volume24h:   ${v.volume24h ?? '❌ undefined'}`);
    console.log(`  symbol:      ${v.symbol ?? '❌ undefined'}`);
  } else {
    console.log(`  ❌ FAILED: ${bOverview.error}`);
  }

  // Birdeye holders
  const bHolders = await safe('birdeye.getTokenHolders', () => integrations.birdeye.getTokenHolders(MINT, 5));
  if (bHolders.ok && bHolders.value) {
    const arr = bHolders.value as any[];
    console.log(`  holders API: ${arr.length} items`);
    if (arr.length > 0) console.log(`  first holder: ${JSON.stringify(arr[0])}`);
  } else {
    console.log(`  ❌ FAILED: ${bHolders.error}`);
  }

  // ── Jupiter ──
  console.log('\n── JUPITER ──');
  const jInfo = await safe('jupiter.getTokenInfo', () => integrations.jupiter.getTokenInfo(MINT));
  if (jInfo.ok && jInfo.value) {
    const v = jInfo.value as any;
    console.log(`  holders:       ${v.holders ?? '❌ undefined'}`);
    console.log(`  marketCap:     ${v.marketCap ?? '❌ undefined'}`);
    console.log(`  liquidity:     ${v.liquidity ?? '❌ undefined'}`);
    console.log(`  price:         ${v.price ?? '❌ undefined'}`);
    console.log(`  volume24h:     ${v.volume24h ?? '❌ undefined'}`);
    console.log(`  symbol:        ${v.symbol ?? '❌ undefined'}`);
    if (v.audit) {
      console.log(`  audit.botHoldersPct: ${v.audit.botHoldersPct ?? '❌ undefined'}`);
      console.log(`  audit.topHoldersPct: ${v.audit.topHoldersPct ?? '❌ undefined'}`);
      console.log(`  audit.bundlerPct:    ${v.audit.bundlerPct ?? '❌ undefined'}`);
    } else {
      console.log(`  audit: ❌ null/undefined`);
    }
  } else {
    console.log(`  ❌ FAILED: ${jInfo.error}`);
  }

  // ── DexScreener ──
  console.log('\n── DEXSCREENER ──');
  const dPairs = await safe('dexscreener.searchPairs', () => integrations.dexscreener.searchPairs(MINT));
  if (dPairs.ok && dPairs.value) {
    const pairs = (dPairs.value as any)?.pairs ?? [];
    const solPairs = pairs.filter((p: any) => p.chainId === 'solana');
    console.log(`  total pairs:   ${pairs.length}`);
    console.log(`  solana pairs:  ${solPairs.length}`);
    if (solPairs.length > 0) {
      const bestLiq = solPairs.reduce((max: number, p: any) => Math.max(max, p.liquidity?.usd ?? 0), 0);
      const bestVol24h = solPairs.reduce((max: number, p: any) => Math.max(max, p.volume?.h24 ?? 0), 0);
      console.log(`  best liquidity: $${bestLiq}`);
      console.log(`  best volume24h: $${bestVol24h}`);
      console.log(`  first pair: ${JSON.stringify(solPairs[0]).slice(0, 400)}`);
    }
  } else {
    console.log(`  ❌ FAILED: ${dPairs.error}`);
  }

  // ── DexScreener getTokenPairs(chain, token) ──
  console.log('\n── DEXSCREENER getTokenPairs ──');
  const dTokenPairs = await safe('dexscreener.getTokenPairs', () => integrations.dexscreener.getTokenPairs('solana', MINT));
  if (dTokenPairs.ok && dTokenPairs.value) {
    const pairs = dTokenPairs.value as any[];
    console.log(`  pairs: ${pairs.length}`);
    if (pairs.length > 0) {
      const bestLiq = pairs.reduce((max: number, p: any) => Math.max(max, p.liquidity?.usd ?? 0), 0);
      console.log(`  best liquidity: $${bestLiq}`);
      console.log(`  first: ${JSON.stringify(pairs[0]).slice(0, 400)}`);
    }
  } else {
    console.log(`  ❌ FAILED: ${dTokenPairs.error}`);
  }

  console.log(`\n${DIVIDER}`);
  console.log('ENRICHMENT VALIDATION COMPLETE');
  console.log(DIVIDER);
}

main().catch(e => console.error('FATAL:', e));
