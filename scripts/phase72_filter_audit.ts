import { getTopCandidates } from '../tools/screening.js';

const DIVIDER = '='.repeat(90);
const SUB = '-'.repeat(90);

function fmt(n: unknown): string {
  if (n == null) return 'null';
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString() : String(n);
}

async function main() {
  console.log(DIVIDER);
  console.log('PHASE 72 — FILTER INTEGRITY AUDIT');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(DIVIDER);

  const s = (await import('../config.js')).config.screening;
  const thresholds = {
    minHolders: s.minHolders,
    minMcap: s.minMcap,
    maxMcap: s.maxMcap,
    maxBotHoldersPct: s.maxBotHoldersPct,
    maxTop10Pct: s.maxTop10Pct,
    minVolume: s.minVolume,
    minTvl: s.minTvl,
  };

  console.log('\n  ── CONFIGURED THRESHOLDS ──');
  for (const [k, v] of Object.entries(thresholds)) {
    console.log(`  ${k.padEnd(18)} = ${v}`);
  }

  // Run discovery
  console.log(`\n${DIVIDER}`);
  console.log('  RUNNING getTopCandidates...');
  console.log(DIVIDER);

  const result = await getTopCandidates({ limit: 100 });
  const candidates = result.candidates;
  const allFiltered = result.all_filtered ?? [];
  const totalScreened = result.total_screened;

  console.log(`\n  Total screened (unique mints): ${totalScreened}`);
  console.log(`  Final candidates returned:     ${candidates.length}`);
  console.log(`  Total filtered reasons:        ${allFiltered.length}`);

  // Print each candidate with full metrics
  console.log(`\n${DIVIDER}`);
  console.log('  FINAL CANDIDATES — FILTER AUDIT');
  console.log(DIVIDER);

  interface Violation {
    name: string;
    mint: string;
    field: string;
    value: number | null;
    threshold: number;
    source: string;
  }
  const violations: Violation[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const holders = c.holders;
    const mcap = c.mcap;
    const liq = c.tvl ?? c.active_tvl ?? 0;
    const volume = c.volume_window ?? 0;
    const botPct = c._enrichment?.botHoldersPct;
    const top10Pct = c._enrichment?.topHoldersPct;
    const src = c.gmgn ? 'gmgn' : c.dex_source ? 'dexscreener' : 'meteora';

    console.log(`\n  Candidate #${i + 1}: ${c.name || c.base?.symbol || '?'}`);
    console.log(`  ${SUB}`);
    console.log(`  mint:         ${c.base?.mint ?? 'null'}`);
    console.log(`  symbol:       ${c.base?.symbol ?? 'null'}`);
    console.log(`  holders:      ${fmt(holders)}`);
    console.log(`  marketCap:    ${fmt(mcap)}`);
    console.log(`  liquidity:    ${fmt(liq)}`);
    console.log(`  volume:       ${fmt(volume)}`);
    console.log(`  botPct:       ${fmt(botPct)}`);
    console.log(`  top10Pct:     ${fmt(top10Pct)}`);
    console.log(`  source:       ${src}`);

    // Check each threshold
    if (mcap != null && mcap > thresholds.maxMcap) {
      violations.push({ name: c.name, mint: c.base?.mint, field: 'marketCap > maxMcap', value: mcap, threshold: thresholds.maxMcap, source: src });
      console.log(`  ❌ VIOLATION: marketCap ${fmt(mcap)} > maxMcap ${fmt(thresholds.maxMcap)}`);
    }
    if (mcap != null && mcap < thresholds.minMcap) {
      violations.push({ name: c.name, mint: c.base?.mint, field: 'marketCap < minMcap', value: mcap, threshold: thresholds.minMcap, source: src });
      console.log(`  ❌ VIOLATION: marketCap ${fmt(mcap)} < minMcap ${fmt(thresholds.minMcap)}`);
    }
    if (holders != null && holders < thresholds.minHolders) {
      violations.push({ name: c.name, mint: c.base?.mint, field: 'holders < minHolders', value: holders, threshold: thresholds.minHolders, source: src });
      console.log(`  ❌ VIOLATION: holders ${fmt(holders)} < minHolders ${fmt(thresholds.minHolders)}`);
    }
    if (volume != null && volume < thresholds.minVolume) {
      violations.push({ name: c.name, mint: c.base?.mint, field: 'volume < minVolume', value: volume, threshold: thresholds.minVolume, source: src });
      console.log(`  ❌ VIOLATION: volume ${fmt(volume)} < minVolume ${fmt(thresholds.minVolume)}`);
    }
    if (liq != null && liq < thresholds.minTvl) {
      violations.push({ name: c.name, mint: c.base?.mint, field: 'tvl < minTvl', value: liq, threshold: thresholds.minTvl, source: src });
      console.log(`  ❌ VIOLATION: tvl ${fmt(liq)} < minTvl ${fmt(thresholds.minTvl)}`);
    }
    if (botPct != null && botPct > thresholds.maxBotHoldersPct) {
      violations.push({ name: c.name, mint: c.base?.mint, field: 'botPct > maxBotHoldersPct', value: botPct, threshold: thresholds.maxBotHoldersPct, source: src });
      console.log(`  ❌ VIOLATION: botPct ${fmt(botPct)} > maxBotHoldersPct ${fmt(thresholds.maxBotHoldersPct)}`);
    }
    if (top10Pct != null && top10Pct > thresholds.maxTop10Pct) {
      violations.push({ name: c.name, mint: c.base?.mint, field: 'top10Pct > maxTop10Pct', value: top10Pct, threshold: thresholds.maxTop10Pct, source: src });
      console.log(`  ❌ VIOLATION: top10Pct ${fmt(top10Pct)} > maxTop10Pct ${fmt(thresholds.maxTop10Pct)}`);
    }

    // FILTER_AUDIT log
    console.log(`  [FILTER_AUDIT] mint=${c.base?.mint?.slice(0, 16) ?? 'null'} symbol=${c.base?.symbol ?? 'null'} holders=${fmt(holders)} mcap=${fmt(mcap)} liq=${fmt(liq)} vol=${fmt(volume)} botPct=${fmt(botPct)} top10Pct=${fmt(top10Pct)} src=${src}`);
  }

  // Count rejections by type
  console.log(`\n${DIVIDER}`);
  console.log('  REJECTION BREAKDOWN');
  console.log(DIVIDER);

  const rejectionCategories: Record<string, number> = {};
  for (const f of allFiltered) {
    const reason = (f.reason as string) || 'unknown';
    let cat = 'other';
    if (reason.includes('mcap') || reason.includes('marketCap')) cat = 'mcap';
    else if (reason.includes('volume')) cat = 'volume';
    else if (reason.includes('TVL') || reason.includes('tvl') || reason.includes('minTvl')) cat = 'tvl';
    else if (reason.includes('holder')) cat = 'holders';
    else if (reason.includes('botPct') || reason.includes('botHoldersPct')) cat = 'botPct';
    else if (reason.includes('top10Pct') || reason.includes('topHoldersPct')) cat = 'top10Pct';
    else if (reason.includes('fee') || reason.includes('ratio')) cat = 'fee/active-TVL';
    else if (reason.includes('volatility')) cat = 'volatility';
    else if (reason.includes('blacklist')) cat = 'blacklist';
    else if (reason.includes('blocked') || reason.includes('deployer')) cat = 'blocked dev';
    else if (reason.includes('position') || reason.includes('occup')) cat = 'occupied position';
    else if (reason.includes('cooldown')) cat = 'cooldown';
    else if (reason.includes('indicator')) cat = 'indicator';
    else if (reason.includes('PVP')) cat = 'PVP';
    else if (reason.includes('bin_step') || reason.includes('binStep')) cat = 'bin_step';
    else if (reason.includes('organic')) cat = 'organic';
    else if (reason.includes('launchpad')) cat = 'launchpad';
    else if (reason.includes('warning') || reason.includes('concentration') || reason.includes('ownership') || reason.includes('critical')) cat = 'token health';
    else if (reason.includes('pool_type')) cat = 'pool_type';
    else if (reason.includes('token age') || reason.includes('TokenAge')) cat = 'token age';
    else if (reason.includes('discord')) cat = 'discord signal';

    rejectionCategories[cat] = (rejectionCategories[cat] || 0) + 1;
  }

  const catOrder = ['mcap', 'volume', 'tvl', 'holders', 'botPct', 'top10Pct',
    'fee/active-TVL', 'volatility', 'organic', 'bin_step', 'pool_type',
    'blacklist', 'blocked dev', 'occupied position', 'cooldown',
    'indicator', 'PVP', 'launchpad', 'token health', 'token age',
    'discord signal', 'other'];
  for (const cat of catOrder) {
    if (rejectionCategories[cat]) {
      const label = cat.padEnd(18);
      console.log(`  ${label} ${rejectionCategories[cat]}`);
    }
  }

  // Summary
  console.log(`\n${DIVIDER}`);
  console.log('  SUMMARY');
  console.log(DIVIDER);
  console.log(`  Total candidates before filters: ${totalScreened}`);
  console.log(`  Total rejections:                ${allFiltered.length}`);
  console.log(`  Final candidates:                ${candidates.length}`);

  if (violations.length === 0) {
    console.log(`\n  ✅ NO THRESHOLD VIOLATIONS — all filters are correctly enforced`);
  } else {
    console.log(`\n  ❌ ${violations.length} VIOLATION(S) FOUND:\n`);
    for (const v of violations) {
      console.log(`  ❌ ${v.name} (${v.mint?.slice(0, 12)}...) ${v.field}: ${fmt(v.value)} vs threshold ${fmt(v.threshold)} (source: ${v.source})`);
    }
  }

  console.log(`\n${DIVIDER}`);
  console.log('FILTER AUDIT COMPLETE');
  console.log(DIVIDER);
}

main().catch(err => {
  console.error('AUDIT FAILED:', err);
  process.exit(1);
});
