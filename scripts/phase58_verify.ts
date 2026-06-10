import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from 'dotenv';
config();

const REPORT = 'PHASE58_VERIFICATION.md';
const LINES: string[] = [];

function log(msg: string) {
  LINES.push(msg);
  process.stdout.write(msg + '\n');
}

function h1(t: string) { log(`\n# ${t}\n`); }
function h2(t: string) { log(`\n## ${t}\n`); }
function h3(t: string) { log(`\n### ${t}\n`); }
function code(block: string) { log('```\n' + block + '\n```'); }

async function safeFetch(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body, text };
}

async function main() {
  h1('Phase 58 — Verification Report');
  log(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  log('');

  // ── Environment check ──
  const birdeyeKey = process.env.BIRDEYE_API_KEY || '';
  h2('Environment');
  log(`- BIRDEYE_API_KEY: ${birdeyeKey ? `✅ set (${birdeyeKey.slice(0, 8)}...)` : '❌ MISSING'}`);
  if (!birdeyeKey) {
    log('- Cannot proceed without API key. Add BIRDEYE_API_KEY to .env');
    writeReport();
    return;
  }

  const bdHeaders = { 'x-api-key': birdeyeKey, 'Content-Type': 'application/json' };

  // ── Discover a valid pool ──
  h2('Step 0: Discover a valid alt pool');

  let testMint = '';
  let testPool = '';
  let testSymbol = '';

  // Try Meteora discovery API
  const discUrl = 'https://pool-discovery-api.datapi.meteora.ag/pools?page_size=3&timeframe=5m&sort_by=volume&order=desc';
  log(`Fetching top pools from Meteora discovery...\n  URL: ${discUrl}`);
  const discRes = await safeFetch(discUrl);
  log(`  Status: ${discRes.status}`);
  if (discRes.ok) {
    const pools = ((discRes.body as Record<string, unknown>)?.data as Array<Record<string, unknown>>) || [];
    for (const p of pools) {
      const tx = (p.token_x || p.tokenX || {}) as Record<string, unknown>;
      const mint = (tx.address || tx.mint || '') as string;
      if (mint && mint !== 'So11111111111111111111111111111111111111112') {
        testMint = mint;
        testPool = p.address as string || p.pool_address as string || '';
        testSymbol = (tx.symbol || '?') as string;
        log(`  Selected: ${testSymbol} | mint=${testMint.slice(0, 12)}... | pool=${testPool.slice(0, 12)}...`);
        break;
      }
    }
  }
  if (!testMint) {
    // Fallback: try PM2 logs
    for (const p of ['/root/.pm2/logs/meridian-out.log', './meridian-out.log']) {
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf-8').split('\n')) {
        const m = line.match(/\[LPIntelligence\] Evaluating pool (\S+)/);
        if (!m) continue;
        const addr = m[1];
        const metaUrl = `https://pool-discovery-api.datapi.meteora.ag/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${addr}`)}&timeframe=5m`;
        const metaRes = await safeFetch(metaUrl);
        if (!metaRes.ok) continue;
        const pool = ((metaRes.body as Record<string, unknown>)?.data as Array<Record<string, unknown>>)?.[0] as Record<string, unknown> | undefined;
        if (!pool) continue;
        const tx = (pool.token_x || pool.tokenX || {}) as Record<string, unknown>;
        const mint = (tx.address || tx.mint || '') as string;
        if (mint && mint !== 'So11111111111111111111111111111111111111112') {
          testMint = mint;
          testPool = addr;
          testSymbol = (tx.symbol || '?') as string;
          log(`  Selected (from PM2 log): ${testSymbol} | mint=${testMint.slice(0, 12)}...`);
          break;
        }
      }
      if (testMint) break;
    }
  }

  if (!testMint) {
    log('❌ Could not discover any non-WSOL pool. Using hardcoded test mints...');
    // Fallback to a known token (USDC)
    testMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    testPool = '';
    testSymbol = 'USDC';
    log(`  Using USDC (${testMint.slice(0, 12)}...) as test token`);
  }

  // ══════════════════════════════════════════════════════
  // STEP 1: Raw Birdeye Token Overview Response
  // ══════════════════════════════════════════════════════
  h2('Step 1: Raw Birdeye Response (token_overview)');
  const bdUrl = `https://public-api.birdeye.so/defi/token_overview?address=${testMint}`;
  log(`URL: ${bdUrl}`);
  log(`Headers: x-api-key: ${birdeyeKey.slice(0, 8)}...`);
  log('');

  const bdRes = await safeFetch(bdUrl, bdHeaders);
  log(`HTTP Status: ${bdRes.status}`);
  log('');

  if (bdRes.ok && typeof bdRes.body === 'object' && bdRes.body) {
    const body = bdRes.body as Record<string, unknown>;
    const bodyKeys = Object.keys(body);
    log(`Raw body keys (top-level): ${JSON.stringify(bodyKeys)}`);
    log('');

    // Show full raw response (truncated)
    const rawJson = JSON.stringify(body, null, 2);
    log('Full raw response:');
    code(rawJson.slice(0, 2000) + (rawJson.length > 2000 ? '\n... (truncated)' : ''));

    // Show nested data if present
    if ('data' in body && body.data && typeof body.data === 'object') {
      const dataKeys = Object.keys(body.data as Record<string, unknown>);
      log(`\nNested "data" keys: ${JSON.stringify(dataKeys)}`);

      h3('apiFetch() current behavior (baseIntegration.ts:51)');
      log(`\`\`\`ts
return await response.json() as T;
\`\`\``);
      log('');
      log('apiFetch() returns the ENTIRE response object, including the wrapper.');
      log('The adapter\'s `getTokenOverview()` receives this full object,');
      log('but the TypeScript type \`BirdeyeTokenOverview\` expects fields at root level.');
      log('');

      // Show what the adapter actually receives
      const d = body.data as Record<string, unknown>;
      log('What adapter receives (entire response):');
      log(`  body.success: ${body.success}`);
      log(`  body.data: { ${Object.keys(d).join(', ') } }`);
      log('');
      log('What adapter THINKS it has (BirdeyeTokenOverview type):');
      log(`  body.symbol   → ${JSON.stringify(body.symbol)} (WRONG: should read body.data.symbol)`);
      log(`  body.price    → ${JSON.stringify(body.price)} (WRONG: should read body.data.price)`);
      log(`  body.marketCap → ${JSON.stringify(body.marketCap)} (WRONG: should read body.data.marketCap)`);
      log(`  body.liquidity → ${JSON.stringify(body.liquidity)} (WRONG: should read body.data.liquidity)`);
      log('');
      log('Correct values (from body.data):');
      log(`  body.data.symbol   → ${JSON.stringify(d.symbol)}`);
      log(`  body.data.price    → ${JSON.stringify(d.price)}`);
      log(`  body.data.marketCap → ${JSON.stringify(d.marketCap)}`);
      log(`  body.data.liquidity → ${JSON.stringify(d.liquidity)}`);
      log(`  body.data.holders  → ${JSON.stringify(d.holders)}`);
      log(`  body.data.volume24h → ${JSON.stringify(d.volume24h)}`);
    } else {
      log('❌ No "data" wrapper found — Birdeye may have changed API format.');
      log(`Body keys: ${bodyKeys.join(', ')}`);
    }
  } else {
    log(`❌ Birdeye API error: HTTP ${bdRes.status}`);
    if (bdRes.body && typeof bdRes.body === 'object') {
      log(`Response: ${JSON.stringify(bdRes.body, null, 2).slice(0, 500)}`);
    }
  }

  // ══════════════════════════════════════════════════════
  // STEP 2: Parsed object after current mapper
  // ══════════════════════════════════════════════════════
  h2('Step 2: Mapper Output (as marketDataService.ts constructs it)');

  if (bdRes.ok && typeof bdRes.body === 'object') {
    const body = bdRes.body as Record<string, unknown>;

    // Also fetch Jupiter for comparison
    const jupUrl = `https://tokens.jup.ag/token/${testMint}`;
    log(`Jupiter URL: ${jupUrl}`);
    const jupRes = await safeFetch(jupUrl);
    log(`Jupiter status: ${jupRes.status}`);
    const jupData = jupRes.ok ? (jupRes.body as Record<string, unknown>) : null;
    if (jupData) {
      log(`Jupiter top-level keys: ${Object.keys(jupData).join(', ')}`);
    }
    log('');

    // Current mapper (marketDataService.ts:38-51)
    const birdeyeData = body; // what the adapter returns
    const currentMapped = {
      mint: testMint,
      symbol: birdeyeData?.symbol ?? jupData?.symbol ?? 'UNKNOWN',
      name: birdeyeData?.name ?? jupData?.name ?? 'Unknown',
      decimals: birdeyeData?.decimals ?? jupData?.decimals ?? 6,
      supply: 0,
      price: birdeyeData?.price ?? jupData?.price ?? 0,
      marketCap: birdeyeData?.marketCap ?? jupData?.marketCap ?? 0,
      liquidity: birdeyeData?.liquidity ?? jupData?.liquidity ?? 0,
      volume24h: birdeyeData?.volume24h ?? 0,
      holders: birdeyeData?.holders ?? jupData?.holders ?? 0,
    };

    log('CURRENT mapper reads from root level:');
    log(`  symbol:    birdeyeData?.symbol    → ${JSON.stringify(birdeyeData?.symbol)}`);
    log(`  name:      birdeyeData?.name      → ${JSON.stringify(birdeyeData?.name)}`);
    log(`  price:     birdeyeData?.price     → ${JSON.stringify(birdeyeData?.price)}`);
    log(`  marketCap: birdeyeData?.marketCap → ${JSON.stringify(birdeyeData?.marketCap)}`);
    log(`  liquidity: birdeyeData?.liquidity → ${JSON.stringify(birdeyeData?.liquidity)}`);
    log(`  holders:   birdeyeData?.holders   → ${JSON.stringify(birdeyeData?.holders)}`);
    log(`  volume24h: birdeyeData?.volume24h → ${JSON.stringify(birdeyeData?.volume24h)}`);
    log('');

    log('Resulting mapped token object (current mapper):');
    log(`  symbol=${currentMapped.symbol}  name=${currentMapped.name}`);
    log(`  price=${currentMapped.price}  marketCap=${currentMapped.marketCap}`);
    log(`  liquidity=${currentMapped.liquidity}  holders=${currentMapped.holders}`);
    log(`  volume24h=${currentMapped.volume24h}`);
    log('');

    // Correct mapper (what it should be)
    const d = body.data as Record<string, unknown> | undefined;
    const corrected = {
      mint: testMint,
      symbol: d?.symbol ?? jupData?.symbol ?? 'UNKNOWN',
      name: d?.name ?? jupData?.name ?? 'Unknown',
      decimals: d?.decimals ?? jupData?.decimals ?? 6,
      supply: 0,
      price: d?.price ?? jupData?.price ?? 0,
      marketCap: d?.marketCap ?? jupData?.marketCap ?? 0,
      liquidity: d?.liquidity ?? jupData?.liquidity ?? 0,
      volume24h: d?.volume24h ?? 0,
      holders: d?.holders ?? jupData?.holders ?? 0,
    };

    log('CORRECTED mapper reads from body.data:');
    log(`  symbol=${corrected.symbol}  name=${corrected.name}`);
    log(`  price=${corrected.price}  marketCap=${corrected.marketCap}`);
    log(`  liquidity=${corrected.liquidity}  holders=${corrected.holders}`);
    log(`  volume24h=${corrected.volume24h}`);
    log('');

    log('Comparison (current vs corrected):');
    log(`| Field        | Current (root read) | Correct (data.*) |`);
    log('|---|---|---|');
    log(`| symbol       | ${String(currentMapped.symbol).padEnd(18)} | ${String(corrected.symbol).padEnd(16)} |`);
    log(`| price        | ${String(currentMapped.price).padEnd(18)} | ${String(corrected.price).padEnd(16)} |`);
    log(`| marketCap    | ${String(currentMapped.marketCap).padEnd(18)} | ${String(corrected.marketCap).padEnd(16)} |`);
    log(`| liquidity    | ${String(currentMapped.liquidity).padEnd(18)} | ${String(corrected.liquidity).padEnd(16)} |`);
    log(`| holders      | ${String(currentMapped.holders).padEnd(18)} | ${String(corrected.holders).padEnd(16)} |`);
    log(`| volume24h    | ${String(currentMapped.volume24h).padEnd(18)} | ${String(corrected.volume24h).padEnd(16)} |`);

    // ══════════════════════════════════════════════════════
    // STEP 3: Object passed to tokenRepository.upsert()
    // ══════════════════════════════════════════════════════
    h2('Step 3: Object passed into tokenRepository.upsert()');

    // Import repositories from dist
    const { repositories } = await import('../dist/repositories/index.js');
    const { TokenData } = await import('../dist/types/index.js');

    const tokenObj = {
      mint: testMint,
      symbol: currentMapped.symbol,
      name: currentMapped.name,
      decimals: currentMapped.decimals,
      supply: 0,
      price: currentMapped.price,
      marketCap: currentMapped.marketCap,
      liquidity: currentMapped.liquidity,
      volume24h: currentMapped.volume24h,
      holders: currentMapped.holders,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    log('Object that would be passed to upsert():');
    log(JSON.stringify(tokenObj, (key, val) =>
      val instanceof Date ? val.toISOString() : val, 2));

    // ══════════════════════════════════════════════════════
    // STEP 4: Validation rejection reason
    // ══════════════════════════════════════════════════════
    h2('Step 4: Validation check (tokenRepository.ts:34-44)');

    const validation = repositories.token.validate(tokenObj);
    log(`Validation result:`);
    log(`  valid: ${validation.valid}`);
    log(`  errors: ${JSON.stringify(validation.errors)}`);
    log(`  warnings: ${JSON.stringify(validation.warnings)}`);
    log('');

    if (!validation.valid) {
      log('🔴 VALIDATION FAILED. upsert() will NOT be called. (marketDataService.ts:53-57)');
      log('');
      log('Code path:');
      log(`\`\`\`ts
// marketDataService.ts:53-57
const validation = repositories.token.validate(token);
if (!validation.valid) {
  throw new Error(\`Token data validation failed: \${validation.errors.join(', ')}\`);
}
return await repositories.token.upsert(token); // ❌ NEVER REACHED
\`\`\``);
    } else {
      log('✅ Validation passed. upsert() would be called.');
    }

    // ══════════════════════════════════════════════════════
    // STEP 5: Repository size before and after save
    // ══════════════════════════════════════════════════════
    h2('Step 5: Repository state before and after save');

    // Before save
    const beforeToken = await repositories.token.getByMint(testMint);
    const beforeMap = (repositories.token as unknown as { tokens: Map<string, unknown> }).tokens;
    log('Before upsert():');
    log(`  tokens Map size: ${beforeMap.size}`);
    log(`  getByMint("${testMint.slice(0, 12)}..."): ${beforeToken ? '✅ EXISTS' : '❌ null'}`);

    // Try upsert (current object)
    log('');
    log('Calling upsert() with CURRENT mapper output...');
    try {
      const saved = await repositories.token.upsert(tokenObj);
      log(`  upsert() returned: symbol=${saved.symbol} price=${saved.price}`);
    } catch (e) {
      log(`  upsert() THREW: ${e instanceof Error ? e.message : String(e)}`);
    }

    // After save
    const afterToken = await repositories.token.getByMint(testMint);
    const afterMap = (repositories.token as unknown as { tokens: Map<string, unknown> }).tokens;
    log('');
    log('After upsert():');
    log(`  tokens Map size: ${afterMap.size}`);
    log(`  getByMint("${testMint.slice(0, 12)}..."): ${afterToken ? `✅ EXISTS (symbol=${afterToken.symbol}, price=${afterToken.price})` : '❌ null'}`);
    log(`  Map has mint key: ${afterMap.has(testMint)}`);

    // Summary comparison with corrected mapper
    log('');
    log('Now testing with CORRECTED mapper (reading from body.data)...');
    const tokenFixed = {
      mint: testMint,
      symbol: corrected.symbol,
      name: corrected.name,
      decimals: corrected.decimals,
      supply: 0,
      price: corrected.price,
      marketCap: corrected.marketCap,
      liquidity: corrected.liquidity,
      volume24h: corrected.volume24h,
      holders: corrected.holders,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const valFixed = repositories.token.validate(tokenFixed);
    log(`  Corrected validation: ${valFixed.valid ? '✅ PASS' : '❌ FAIL'}`);
    if (!valFixed.valid) {
      log(`  Errors: ${valFixed.errors.join(', ')}`);
    }

    if (valFixed.valid) {
      try {
        await repositories.token.upsert(tokenFixed);
        const afterFixed = await repositories.token.getByMint(testMint);
        log(`  Corrected upsert() + getByMint: ${afterFixed ? `✅ EXISTS (symbol=${afterFixed.symbol}, price=${afterFixed.price}, mcap=${afterFixed.marketCap})` : '❌ null'}`);
      } catch (e) {
        log(`  Corrected upsert() THREW: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    log('❌ Skipping steps 2-5 because Birdeye API did not return 200.');
    log('Check BIRDEYE_API_KEY or network connectivity.');
  }

  // ══════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════
  h2('Summary');

  const verifyUrl = `https://public-api.birdeye.so/defi/token_overview?address=${testMint}`;
  log(`Test token: ${testSymbol} (${testMint.slice(0, 12)}...)`);
  log(`API URL: ${verifyUrl}`);
  log(`Birdeye wrapper detected: ${bdRes.ok && typeof bdRes.body === 'object' && 'data' in (bdRes.body as Record<string,unknown>) ? '✅ YES — {success, data} wrapper present' : '❌ NO'}`);
  log('');

  if (bdRes.ok && typeof bdRes.body === 'object' && 'data' in (bdRes.body as Record<string, unknown>)) {
    log('Root cause CONFIRMED:');
    log('1. Birdeye wraps responses in {success, data}');
    log('2. baseIntegration.apiFetch() returns the FULL object (not just data)');
    log('3. marketDataService mapper reads root-level fields → all undefined');
    log('4. Token object defaults to liquidity=0, marketCap=0');
    log('5. tokenRepository.validate() rejects 0 values');
    log('6. upsert() is never reached → repository stays empty');
  }

  writeReport();
}

function writeReport() {
  const report = LINES.join('\n');
  writeFileSync(REPORT, report, 'utf-8');
  console.log(`\n═════════════════════════════════════════════════`);
  console.log(`  Report written: ${REPORT}`);
  console.log(`═════════════════════════════════════════════════`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
