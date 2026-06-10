import { discoverPools, getTopCandidates } from '../tools/screening.js';
import { config } from '../config.js';

const DIVIDER = '='.repeat(90);

async function main() {
  console.log(DIVIDER);
  console.log('PHASE 69 — SCREENING EXPANSION VALIDATION');
  console.log(`Time:  ${new Date().toISOString()}`);
  console.log(DIVIDER);

  // Show current config
  const s = config.screening;
  console.log('\n  ── CURRENT SCREENING CONFIG ──');
  console.log(`  source:              ${s.source}`);
  console.log(`  minTvl:              ${s.minTvl}`);
  console.log(`  maxTvl:              ${s.maxTvl}`);
  console.log(`  minVolume:           ${s.minVolume}`);
  console.log(`  minOrganic:          ${s.minOrganic}`);
  console.log(`  minQuoteOrganic:     ${s.minQuoteOrganic}`);
  console.log(`  minHolders:          ${s.minHolders}`);
  console.log(`  minMcap:             ${s.minMcap}`);
  console.log(`  maxMcap:             ${s.maxMcap}`);
  console.log(`  maxBotHoldersPct:    ${s.maxBotHoldersPct}`);
  console.log(`  maxTop10Pct:         ${s.maxTop10Pct}`);

  const m = config.management;
  console.log('\n  ── MANAGEMENT CONFIG ──');
  console.log(`  takeProfitPct:       ${m.takeProfitPct}`);
  console.log(`  trailingTriggerPct:  ${m.trailingTriggerPct}`);
  console.log(`  trailingDropPct:     ${m.trailingDropPct}`);

  // Run discovery
  console.log(`\n${DIVIDER}`);
  console.log('  RUNNING discoverPools...');
  console.log(DIVIDER);

  let discovery;
  try {
    discovery = await discoverPools({ page_size: 50 });
    console.log(`\n  Pool Discovery API returned:`);
    console.log(`  total: ${discovery.total}`);
    console.log(`  pools before filters: ${(discovery.pools ?? []).length}`);
    console.log(`  filtered examples: ${(discovery.filtered_examples ?? []).length}`);

    if (discovery.filtered_examples?.length > 0) {
      console.log(`\n  ── FILTERED EXAMPLES (up to 10) ──`);
      for (const ex of discovery.filtered_examples.slice(0, 10)) {
        console.log(`  ❌ ${ex.name}: ${ex.reason}`);
      }
    }
  } catch (err) {
    console.log(`\n  ❌ discoverPools failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Run getTopCandidates (will also run enrichment)
  console.log(`\n${DIVIDER}`);
  console.log('  RUNNING getTopCandidates...');
  console.log(DIVIDER);

  try {
    const result = await getTopCandidates({ limit: 10 });
    console.log(`\n  Source:              ${result.source}`);
    console.log(`  Total screened:      ${result.total_screened}`);
    console.log(`  Candidates returned: ${result.candidates.length}`);

    if (result.candidates.length > 0) {
      console.log(`\n  ── TOP CANDIDATES ──`);
      for (let i = 0; i < result.candidates.length; i++) {
        const c = result.candidates[i];
        const e = c._enrichment;
        const enrichmentStr = e ? `birdeyeHldrs=${e.birdeyeHolders ?? '?'} jupHldrs=${e.jupiterHolders ?? '?'} botPct=${e.botHoldersPct ?? '?'} topPct=${e.topHoldersPct ?? '?'}` : 'no enrichment';
        console.log(`  ${i + 1}. ${c.name || c.base?.symbol || '?'} | mcap=$${c.mcap} tvl=$${c.tvl} vol=$${c.volume_window} hldrs=${c.holders} | ${enrichmentStr}`);
      }
    }

    if (result.all_filtered?.length > 0) {
      const enrichFiltered = result.all_filtered.filter(f => f.reason?.includes('botHoldersPct') || f.reason?.includes('topHoldersPct'));
      if (enrichFiltered.length > 0) {
        console.log(`\n  ── ENRICHMENT-FILTERED CANDIDATES ──`);
        for (const f of enrichFiltered) {
          console.log(`  ❌ ${f.name}: ${f.reason}`);
        }
      }
    }

    console.log(`\n  ── ALL FILTERED REASONS (up to 20) ──`);
    if (result.all_filtered?.length > 0) {
      const counts = {};
      for (const f of result.all_filtered) {
        const reason = f.reason?.split(' ').slice(0, 4).join(' ') || f.reason;
        counts[reason] = (counts[reason] || 0) + 1;
      }
      for (const [reason, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${reason}: ${count}`);
      }
    } else {
      console.log('  (none)');
    }

  } catch (err) {
    console.log(`\n  ❌ getTopCandidates failed: ${err instanceof Error ? err.message : String(err)}`);
    if (err.stack) console.log(err.stack.slice(0, 500));
  }

  console.log(`\n${DIVIDER}`);
  console.log('VALIDATION COMPLETE');
  console.log(DIVIDER);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
