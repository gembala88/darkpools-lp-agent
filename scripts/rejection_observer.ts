import { readFileSync, existsSync, writeFileSync } from 'fs';

interface DecisionEntry {
  type: string;
  actor: string;
  summary: string;
  reason?: string;
  pool?: string;
  pool_name?: string;
  rejected?: string[];
  [key: string]: unknown;
}

interface LogEntry {
  pool: string;
  poolName: string;
  score: number;
  decision: string;
  timestamp: string;
}

interface IndicatorRejection {
  poolName: string;
  reason: string;
}

function readJsonLog(): DecisionEntry[] {
  const path = 'decision-log.json';
  if (!existsSync(path)) {
    console.log('decision-log.json not found');
    return [];
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function parseDecisionLog(entries: DecisionEntry[]) {
  const noDeploy = entries.filter(e => e.type === 'no_deploy');

  const byReason: Record<string, number> = {};
  const byPool: string[] = [];

  for (const entry of noDeploy) {
    const reason = entry.reason || entry.summary || 'unknown';
    const key = reason.length > 80 ? reason.slice(0, 80) + '...' : reason;
    byReason[key] = (byReason[key] || 0) + 1;

    if (entry.pool_name) byPool.push(entry.pool_name);
    if (entry.pool) byPool.push(entry.pool);
  }

  return { totalNoDeploy: noDeploy.length, byReason, byPool };
}

function parsePm2Log(): { indicators: IndicatorRejection[]; evaluations: LogEntry[] } {
  const paths = [
    '/root/.pm2/logs/meridian-out.log',
    './meridian-out.log',
  ];

  let content = '';
  for (const p of paths) {
    if (existsSync(p)) {
      content = readFileSync(p, 'utf-8');
      break;
    }
  }

  if (!content) {
    console.log('No PM2 log found. Run: cat /root/.pm2/logs/meridian-out.log > meridian-out.log');
    return { indicators: [], evaluations: [] };
  }

  const lines = content.split('\n');
  const indicators: IndicatorRejection[] = [];
  const evaluations: LogEntry[] = [];

  for (const line of lines) {
    const indMatch = line.match(/\[SCREENING\] Indicator rejected (.+): (.+)$/);
    if (indMatch) {
      indicators.push({ poolName: indMatch[1], reason: indMatch[2] });
    }

    const evalMatch = line.match(/\[INFO\] \[LPIntelligence\] Evaluation complete: score=([0-9.]+), decision=(\w+)/);
    if (evalMatch) {
      const tsMatch = line.match(/^(\S+)/);
      evaluations.push({
        pool: '',
        poolName: '',
        score: parseFloat(evalMatch[1]),
        decision: evalMatch[2],
        timestamp: tsMatch ? tsMatch[1] : '',
      });
    }

    const poolMatch = line.match(/\[LPIntelligence\] Evaluating pool (\S+)/);
    if (poolMatch && evaluations.length > 0 && !evaluations[evaluations.length - 1].pool) {
      evaluations[evaluations.length - 1].pool = poolMatch[1];
    }
  }

  return { indicators, evaluations };
}

function generateReport(logEntries: ReturnType<typeof parseDecisionLog>, pm2: ReturnType<typeof parsePm2Log>): string {
  const { totalNoDeploy, byReason, byPool } = logEntries;
  const { indicators, evaluations } = pm2;

  const totalEvals = evaluations.length;
  const rejectedEvals = evaluations.filter(e => e.decision === 'REJECT');
  const totalRejections = totalNoDeploy + indicators.length + rejectedEvals.length;

  const sortedReasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
  const total = totalNoDeploy || 1;

  const lines: string[] = [];

  lines.push('# Rejection Analysis Report');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Total rejections observed:** ${totalRejections}`);
  lines.push(`**Source:** decision-log.json (${totalNoDeploy} entries) + PM2 logs`);
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---|');
  lines.push(`| Decision-log "no_deploy" entries | ${totalNoDeploy} |`);
  lines.push(`| Indicator rejections (pre-AI) | ${indicators.length} |`);
  lines.push(`| AI evaluations (REJECT) | ${rejectedEvals.length} / ${totalEvals} |`);
  lines.push(`| Unique markets evaluated | ${byPool.length} |`);
  lines.push('');

  lines.push('## Top Rejection Reasons');
  lines.push('');
  lines.push('| Reason | Count | % |');
  lines.push('|---|---|---|');
  for (const [reason, count] of sortedReasons.slice(0, 15)) {
    const pct = ((count / total) * 100).toFixed(1);
    lines.push(`| ${reason} | ${count} | ${pct}% |`);
  }
  lines.push('');

  if (indicators.length > 0) {
    lines.push('## Indicator-Level Rejections (pre-AI)');
    lines.push('');
    lines.push('| Pool | Reason |');
    lines.push('|---|---|');
    for (const ind of indicators.slice(0, 10)) {
      lines.push(`| ${ind.poolName} | ${ind.reason} |`);
    }
    if (indicators.length > 10) {
      lines.push(`| ... and ${indicators.length - 10} more | |`);
    }
    lines.push('');

    const indicatorByReason: Record<string, number> = {};
    for (const ind of indicators) {
      indicatorByReason[ind.reason] = (indicatorByReason[ind.reason] || 0) + 1;
    }
    const sortedIndReasons = Object.entries(indicatorByReason).sort((a, b) => b[1] - a[1]);

    lines.push('### Indicator Rejection Breakdown');
    lines.push('');
    lines.push('| Reason | Count | % |');
    lines.push('|---|---|---|');
    for (const [r, c] of sortedIndReasons) {
      const pct = ((c / indicators.length) * 100).toFixed(1);
      lines.push(`| ${r} | ${c} | ${pct}% |`);
    }
    lines.push('');
  }

  if (evaluations.length > 0) {
    const scoreRanges = { '0-10': 0, '10-30': 0, '30-50': 0, '50-70': 0, '70+': 0 };
    for (const e of evaluations) {
      if (e.score < 10) scoreRanges['0-10']++;
      else if (e.score < 30) scoreRanges['10-30']++;
      else if (e.score < 50) scoreRanges['30-50']++;
      else if (e.score < 70) scoreRanges['50-70']++;
      else scoreRanges['70+']++;
    }

    lines.push('## AI LP Alpha Score Distribution');
    lines.push('');
    lines.push('| Score Range | Count |');
    lines.push('|---|---|');
    for (const [range, count] of Object.entries(scoreRanges)) {
      if (count > 0) lines.push(`| ${range} | ${count} |`);
    }
    lines.push('');
  }

  lines.push('## Dominant Filters Analysis');
  lines.push('');
  const dominant = sortedReasons.filter(([, c]) => (c / total) > 0.5);
  const overlyStrict = sortedReasons.filter(([, c]) => (c / total) > 0.3);

  if (dominant.length > 0) {
    lines.push('### Filters causing >50% of rejections:');
    for (const [filter, count] of dominant) {
      const pct = ((count / total) * 100).toFixed(1);
      lines.push(`- **${filter}**: ${count} rejections (${pct}%) — DOMINANT`);
    }
  } else {
    lines.push('### No single filter >50%');
  }
  lines.push('');

  if (overlyStrict.length > 0) {
    lines.push('### Filters with >30% rejection share:');
    for (const [filter, count] of overlyStrict) {
      const pct = ((count / total) * 100).toFixed(1);
      lines.push(`- **${filter}**: ${count} rejections (${pct}%)`);
    }
  }
  lines.push('');

  if (indicators.length > 0) {
    lines.push('### Pre-AI Indicator Filter Impact');
    const indicatorTotal = indicators.length;
    const totalFiltered = indicatorTotal + totalNoDeploy;
    lines.push(`Indicator rejections block **${indicatorTotal}** pools before AI evaluation.`);
    lines.push(`That is **${totalFiltered > 0 ? ((indicatorTotal / totalFiltered) * 100).toFixed(0) : 0}%** of all filtered pools.`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Observations');
  lines.push('');
  lines.push('Based on log data — no code changes made:');
  lines.push('');
  lines.push(`1. Decision-log shows ${totalNoDeploy} no_deploy cycles with ${Object.keys(byReason).length} unique reason patterns`);
  lines.push(`2. AI engine evaluated ${totalEvals} pools with ${rejectedEvals.length} REJECT decisions`);
  lines.push(`3. Pre-AI indicators rejected ${indicators.length} pools`);

  if (dominant.length > 0) {
    lines.push(`4. **${dominant[0][0]}** dominates rejections — may warrant threshold review after 48h`);
  }

  lines.push('');

  return lines.join('\n');
}

function main() {
  const logEntries = readJsonLog();
  const pm2 = parsePm2Log();

  const report = generateReport(parseDecisionLog(logEntries), pm2);
  writeFileSync('REJECTION_ANALYSIS_REPORT.md', report, 'utf-8');
  console.log('REJECTION_ANALYSIS_REPORT.md generated');
  console.log(`  decision-log entries: ${logEntries.length}`);
  console.log(`  indicator rejections: ${pm2.indicators.length}`);
  console.log(`  AI evaluations: ${pm2.evaluations.length}`);
}

main();
