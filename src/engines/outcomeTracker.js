import fs from 'fs';
import { repoPath } from '../../repo-root.js';
import { log } from '../../logger.js';

const MEMORY_FILE = () => repoPath('data', 'deployment-memory.json');

export async function checkOutcomes() {
  try {
    const absPath = MEMORY_FILE();
    if (!fs.existsSync(absPath)) return;

    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const deploys = raw.deploys || [];
    let changed = false;

    for (const deploy of deploys) {
      if (deploy.verdict !== 'PENDING') continue;

      const entryTime = new Date(deploy.entryTime).getTime();
      if (!entryTime) continue;
      const now = Date.now();
      const ageHours = (now - entryTime) / (1000 * 60 * 60);

      if (ageHours >= 4 && deploy.outcome4h == null) {
        deploy.outcome4h = {
          checkedAt: new Date().toISOString(),
          currentTvl: null,
          tvlChange: null,
          feesEarned: null,
          priceChange: null,
          note: 'SIMULATED (no real funds — pool survived 4h in discovery)',
        };
        deploy.verdict = 'NEUTRAL';
        changed = true;
        const line = `📊 [SIM] Outcome ${deploy.name}: ${deploy.verdict} | TVLΔ=${deploy.outcome4h.tvlChange ?? '?'}% | fees=$${deploy.outcome4h.feesEarned ?? '?'} | source=${deploy.deploySource ?? 'ai_chosen'}`;
        log("deploy", `[OUTCOME] ${line}`);
        try {
          const { sendToChannel } = await import('../../telegram.js');
          sendToChannel(line, "info").catch(() => {});
        } catch (_) {}
      } else if (ageHours >= 1 && deploy.outcome1h == null) {
        deploy.outcome1h = {
          checkedAt: new Date().toISOString(),
          currentTvl: null,
          tvlChange: null,
          feesEarned: null,
          priceChange: null,
          note: 'SIMULATED (no real funds — pool survived 1h in discovery)',
        };
        changed = true;
        log("deploy", `[OUTCOME] ${deploy.name} → 1h check passed (source=${deploy.deploySource ?? 'ai_chosen'})`);
      }
    }

    if (changed) {
      fs.writeFileSync(absPath, JSON.stringify(raw, null, 2));
      const completed = deploys.filter(d => d.verdict !== 'PENDING').length;
      log("deploy", `[OUTCOME] Updated ${completed}/${deploys.length} entries`);
    }
  } catch (e) {
    log("deploy", `[OUTCOME] checkOutcomes error: ${e.message} | ${e.stack}`);
  }
}
