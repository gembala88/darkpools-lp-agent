import { MarketDataService } from '../src/services/marketDataService.js';
import { repositories } from '../src/repositories/index.js';

const DIVIDER = '='.repeat(90);

function repoCounts(): Record<string, number> {
  const t = (repositories.token as any);
  const h = (repositories.holder as any);
  const tx = (repositories.transaction as any);
  const m = (repositories.market as any);
  const l = (repositories.liquidity as any);
  return {
    TOKEN:       t?.tokens?.size ?? 0,
    HOLDER:      h?.holders?.size ?? 0,
    TRANSACTION: tx?.transactions?.length ?? 0,
    MARKET:      m?.snapshots?.length ?? 0,
    LIQUIDITY:   l?.snapshots?.length ?? 0,
  };
}

function printTable(title: string, counts: Record<string, number>) {
  console.log(`\n  ${title}`);
  console.log(`  ${'-'.repeat(40)}`);
  for (const [name, val] of Object.entries(counts)) {
    const icon = val > 0 ? '✅' : '❌';
    console.log(`  ${icon} ${name.padEnd(13)} ${val}`);
  }
}

async function validate(mint: string, poolAddress: string) {
  console.log(`\n${DIVIDER}`);
  console.log(`PHASE 66 — PIPELINE VALIDATION`);
  console.log(`${DIVIDER}`);
  console.log(`\n  Pool: ${poolAddress}`);
  console.log(`  Mint: ${mint}`);
  console.log(`  Time: ${new Date().toISOString()}`);

  const before = repoCounts();
  printTable('BEFORE SYNC', before);

  console.log(`\n${DIVIDER}`);
  console.log(`  RUNNING fullSync...`);
  console.log(DIVIDER);

  const mds = new MarketDataService();
  let syncOk = false;
  let syncResult: Awaited<ReturnType<typeof mds.fullSync>> | null = null;

  try {
    syncResult = await mds.fullSync(mint, poolAddress);
    syncOk = true;
  } catch (err) {
    console.log(`\n  ❌ fullSync threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  const after = repoCounts();
  printTable('AFTER SYNC', after);

  console.log(`\n  ── DELTA ──`);
  let allPass = true;
  for (const name of Object.keys(before)) {
    const d = after[name] - before[name];
    const icon = d > 0 ? '✅' : (d === 0 ? '—' : '❌');
    const status = d > 0 ? `+${d}` : (d === 0 ? '0' : String(d));
    console.log(`  ${icon} ${name.padEnd(13)} ${before[name]} → ${after[name]} (${status})`);
    if (d <= 0) allPass = false;
  }

  if (syncResult) {
    console.log(`\n  ── fullSync DETAIL ──`);
    console.log(`  token:       ${syncResult.token ? `✅ ${syncResult.token.symbol} mcap=${syncResult.token.marketCap} liq=${syncResult.token.liquidity}` : '❌ null'}`);
    console.log(`  holders:     ${syncResult.holders > 0 ? `✅ ${syncResult.holders} saved` : '❌ 0'}`);
    console.log(`  transactions:${syncResult.transactions > 0 ? `✅ ${syncResult.transactions} saved` : '❌ 0'}`);
    console.log(`  market:      ${syncResult.market ? `✅ vol5m=${syncResult.market.volume5m} tx5m=${syncResult.market.txCount5m}` : '❌ null'}`);
    console.log(`  liquidity:   ${syncResult.liquidity ? `✅ liq=${syncResult.liquidity.liquidity} tvl=${syncResult.liquidity.tvl} src=${syncResult.liquidity.source}` : '❌ null'}`);
  }

  console.log(`\n  ── VERDICT ──`);
  if (allPass) {
    console.log(`  ✅ ALL 5 REPOSITORIES POPULATED — pipeline repair successful`);
    console.log(`  Score variance should now emerge across pools`);
  } else {
    const empty = Object.entries(after).filter(([, v]) => v <= 0).map(([k]) => k);
    console.log(`  ❌ ${empty.length} repository(ies) still empty: ${empty.join(', ')}`);
    console.log(`  Check runtime logs above for specific failure reasons`);
  }

  console.log(`\n${DIVIDER}`);
  console.log(`VALIDATION COMPLETE`);
  console.log(DIVIDER);
}

const poolArg = process.argv.find(a => a.startsWith('--pool='));
const mintArg = process.argv.find(a => a.startsWith('--mint='));

if (!poolArg || !mintArg) {
  console.error('Usage: npx tsx scripts/phase66_pipeline_validation.ts --pool=<address> --mint=<address>');
  process.exit(1);
}

const poolAddress = poolArg.split('=')[1];
const tokenMint = mintArg.split('=')[1];

validate(tokenMint, poolAddress).catch(err => {
  console.error('VALIDATION FAILED:', err);
  process.exit(1);
});
