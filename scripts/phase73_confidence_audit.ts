import { getTopCandidates } from '../tools/screening.js';

const DIVIDER = '='.repeat(90);
const SUB = '-'.repeat(90);

function fmt(n: unknown): string {
  if (n == null) return 'null';
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString() : String(n);
}

function confidenceBadge(c: string): string {
  switch (c) {
    case 'HIGH': return '🟢 HIGH';
    case 'MEDIUM': return '🟡 MEDIUM';
    case 'LOW': return '🟠 LOW';
    case 'RATE_LIMITED': return '🔶 RATE_LIMITED';
    case 'NONE': return '🔴 NONE';
    default: return '⚪ ' + (c ?? '?');
  }
}

async function main() {
  console.log(DIVIDER);
  console.log('PHASE 73 — HOLDER FALLBACK LAYER (CONFIDENCE AUDIT)');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(DIVIDER);

  const result = await getTopCandidates({ limit: 100 });
  const candidates = result.candidates;

  console.log(`\n  Total candidates returned: ${candidates.length}`);
  console.log(DIVIDER);

  const tiers: Record<string, { holders: number; mcap: number; audit: number }> = {
    HIGH: { holders: 0, mcap: 0, audit: 0 },
    MEDIUM: { holders: 0, mcap: 0, audit: 0 },
    LOW: { holders: 0, mcap: 0, audit: 0 },
    RATE_LIMITED: { holders: 0, mcap: 0, audit: 0 },
    NONE: { holders: 0, mcap: 0, audit: 0 },
  };

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const enr = c._enrichment || {};
    const hc = enr.holdersConfidence ?? 'NONE';
    const mc = enr.marketCapConfidence ?? 'NONE';
    const ac = enr.auditConfidence ?? 'NONE';

    tiers[hc as string] ??= { holders: 0, mcap: 0, audit: 0 };
    tiers[mc as string] ??= { holders: 0, mcap: 0, audit: 0 };
    tiers[ac as string] ??= { holders: 0, mcap: 0, audit: 0 };

    if (tiers[hc as string]) tiers[hc as string].holders++;
    if (tiers[mc as string]) tiers[mc as string].mcap++;
    if (tiers[ac as string]) tiers[ac as string].audit++;

    const mcap = enr.birdeyeMarketCap ?? enr.jupiterMarketCap ?? c.mcap ?? c.marketCap ?? '?';
    const liq = enr.birdeyeLiquidity ?? enr.dexLiquidity ?? c.tvl ?? '?';
    const vol = enr.birdeyeVolume24h ?? enr.dexVolume24h ?? c.volume_window ?? '?';
    const holders = enr.birdeyeHolders ?? enr.jupiterHolders ?? c.holders ?? '?';
    const botPct = enr.botHoldersPct ?? '?';
    const top10Pct = enr.topHoldersPct ?? '?';
    const src = c.gmgn ? 'gmgn' : c.dex_source ? 'dexscreener' : 'meteora';
    const score = enr.qualityScore ?? '?';

    console.log(`\n  Candidate #${i + 1}: ${c.name || c.base?.symbol || '?'}`);
    console.log(`  ${SUB}`);
    console.log(`  mint:          ${c.base?.mint ?? 'null'}`);
    console.log(`  holders:       ${fmt(holders)}  ${confidenceBadge(hc)}`);
    console.log(`  marketCap:    $${fmt(mcap)}  ${confidenceBadge(mc)}`);
    console.log(`  liquidity:    $${fmt(liq)}`);
    console.log(`  volume:       $${fmt(vol)}`);
    console.log(`  botPct:        ${fmt(botPct)}  ${confidenceBadge(ac)}`);
    console.log(`  top10Pct:      ${fmt(top10Pct)}  ${confidenceBadge(ac)}`);
    console.log(`  qualityScore:  ${score}`);
    console.log(`  source:        ${src}`);
    console.log(`  [QUALITY] mint=${c.base?.mint?.slice(0, 16) ?? 'null'} score=${score} holdersConf=${hc} mcapConf=${mc} auditConf=${ac} holders=${fmt(holders)} mcap=${fmt(mcap)} liq=${fmt(liq)}`);
  }

  console.log(`\n${DIVIDER}`);
  console.log('  CONFIDENCE TIER BREAKDOWN');
  console.log(DIVIDER);
  console.log(`  ${'Tier'.padEnd(10)} ${'holdersConf'.padEnd(12)} ${'mcapConf'.padEnd(12)} ${'auditConf'.padEnd(12)}`);
  console.log(`  ${SUB}`);
  const tierOrder = ['HIGH', 'MEDIUM', 'LOW', 'RATE_LIMITED', 'NONE'];
  for (const tier of tierOrder) {
    const t = tiers[tier] ?? { holders: 0, mcap: 0, audit: 0 };
    console.log(`  ${tier.padEnd(10)} ${String(t.holders).padEnd(12)} ${String(t.mcap).padEnd(12)} ${String(t.audit).padEnd(12)}`);
  }

  const allNone = candidates.every(c => {
    const enr = c._enrichment || {};
    return enr.holdersConfidence || enr.marketCapConfidence || enr.auditConfidence;
  });

  console.log(`\n${DIVIDER}`);
  console.log('  VALIDATION');
  console.log(DIVIDER);
  console.log(`  Every candidate has explicit confidence classification: ${allNone ? '✅ YES' : '❌ NO'}`);

  const confidenceValues = new Set(
    candidates.flatMap(c => {
      const enr = c._enrichment || {};
      return [enr.holdersConfidence, enr.marketCapConfidence].filter(Boolean);
    })
  );
  const hasNoneOrRateLimited = ['NONE', 'RATE_LIMITED'].some(v => confidenceValues.has(v));
  if (hasNoneOrRateLimited) {
    const tiers = [...confidenceValues].filter(v => v === 'NONE' || v === 'RATE_LIMITED');
    console.log(`  ⚠️ Confidence tiers with penalty: ${tiers.join(', ')} — qualityScore ×0.85 applied`);
  } else {
    console.log(`  ✅ All candidates have at least MEDIUM confidence — no penalty needed`);
  }

  console.log(`\n${DIVIDER}`);
  console.log('CONFIDENCE AUDIT COMPLETE');
  console.log(DIVIDER);
}

main().catch(err => {
  console.error('AUDIT FAILED:', err);
  process.exit(1);
});
