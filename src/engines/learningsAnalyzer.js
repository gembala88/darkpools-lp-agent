import fs from 'fs';
import { repoPath } from '../../repo-root.js';
import { log } from '../../logger.js';

const MEMORY_FILE = () => repoPath('data', 'deployment-memory.json');

export function analyzeDeploymentMemory() {
  try {
    const absPath = MEMORY_FILE();
    if (!fs.existsSync(absPath)) {
      return { error: 'No deployment memory found' };
    }

    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const deploys = raw.deploys || [];

    const sources = {};

    for (const d of deploys) {
      const source = d.deploySource || 'ai_chosen';
      if (!sources[source]) {
        sources[source] = { deploys: [], completed: 0, profits: 0, losses: 0, neutrals: 0, lanes: {} };
      }
      sources[source].deploys.push(d);

      if (d.verdict && d.verdict !== 'PENDING') {
        sources[source].completed++;
        if (d.verdict === 'PROFIT') sources[source].profits++;
        else if (d.verdict === 'LOSS') sources[source].losses++;
        else sources[source].neutrals++;
      }

      if (d.lane) {
        if (!sources[source].lanes[d.lane]) {
          sources[source].lanes[d.lane] = { count: 0, profits: 0, completed: 0 };
        }
        sources[source].lanes[d.lane].count++;
        if (d.verdict && d.verdict !== 'PENDING') {
          sources[source].lanes[d.lane].completed++;
          if (d.verdict === 'PROFIT') sources[source].lanes[d.lane].profits++;
        }
      }
    }

    const result = {};
    for (const [source, data] of Object.entries(sources)) {
      const completed = data.completed;
      const s = {
        totalDeploys: data.deploys.length,
        completed,
        winRate: completed >= 3 ? (data.profits / completed * 100).toFixed(1) : null,
        collecting: completed < 3,
        profits: data.profits,
        losses: data.losses,
        neutrals: data.neutrals,
        avgTvlChange: null,
        avgFeesEarned: null,
        perLane: {},
        bestLaneRegime: null,
        worstLaneRegime: null,
      };

      let bestLane = null, bestRate = -1, worstLane = null, worstRate = 101;
      for (const [lane, ld] of Object.entries(data.lanes)) {
        s.perLane[lane] = { count: ld.count, completed: ld.completed, winRate: ld.completed >= 2 ? (ld.completed > 0 ? (ld.profits / ld.completed * 100).toFixed(1) : '0.0') : null };
        if (ld.completed >= 2) {
          const rate = ld.completed > 0 ? (ld.profits / ld.completed * 100) : 0;
          if (rate > bestRate) { bestRate = rate; bestLane = lane; }
          if (rate < worstRate) { worstRate = rate; worstLane = lane; }
        }
      }
      s.bestLaneRegime = bestLane ? `${bestLane} (${bestRate.toFixed(0)}% win, n=${data.lanes[bestLane].completed})` : null;
      s.worstLaneRegime = worstLane ? `${worstLane} (${worstRate.toFixed(0)}% win, n=${data.lanes[worstLane].completed})` : null;

      result[source] = s;
    }

    return result;
  } catch (e) {
    log("deploy", `[LEARNINGS] analyze error: ${e.message}`);
    return { error: e.message };
  }
}
