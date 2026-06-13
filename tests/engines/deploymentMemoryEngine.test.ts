import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DeploymentMemoryEngine } from '../../dist/engines/deploymentMemoryEngine.js';

const DRY_FILE = path.resolve('data/dry-run-deployment-memory.json');
const LIVE_FILE = path.resolve('data/live-deployment-memory.json');
const OLD_FILE = path.resolve('data/deployment-memory.json');

const sampleRecord = {
  poolAddress: 'test_pool',
  tokenMint: 'test_mint',
  lpAlphaScore: 80,
  momentumScore: 60,
  marketRegime: 'RANGING',
  deploymentDecision: 'SIMULATE',
  profit: 0,
  loss: 0,
  apr: 0,
  feeGenerated: 0,
  timestamp: new Date(),
};

describe('DeploymentMemoryEngine mode separation', () => {
  const origDryRun = process.env.DRY_RUN;

  afterEach(() => {
    process.env.DRY_RUN = origDryRun;
    // Clean up test files
    try { fs.unlinkSync(DRY_FILE); } catch {}
    try { fs.unlinkSync(LIVE_FILE); } catch {}
    try { fs.unlinkSync(OLD_FILE); } catch {}
  });

  it('should use dry-run-deployment-memory.json when DRY_RUN=true', () => {
    process.env.DRY_RUN = 'true';
    const engine = new DeploymentMemoryEngine();
    engine.recordDeployment(sampleRecord);
    expect(fs.existsSync(DRY_FILE)).toBe(true);
    expect(fs.existsSync(LIVE_FILE)).toBe(false);
  });

  it('should use live-deployment-memory.json when DRY_RUN=false', () => {
    process.env.DRY_RUN = 'false';
    const engine = new DeploymentMemoryEngine();
    engine.recordDeployment(sampleRecord);
    expect(fs.existsSync(LIVE_FILE)).toBe(true);
    expect(fs.existsSync(DRY_FILE)).toBe(false);
  });

  it('should NOT share data between dry-run and live modes', () => {
    // Write a record in DRY_RUN mode
    process.env.DRY_RUN = 'true';
    const dryEngine = new DeploymentMemoryEngine();
    dryEngine.recordDeployment(sampleRecord);
    expect(dryEngine.getHistory().length).toBe(1);

    // LIVE mode should NOT see it
    process.env.DRY_RUN = 'false';
    const liveEngine = new DeploymentMemoryEngine();
    expect(liveEngine.getHistory().length).toBe(0);
  });

  it('should migrate old deployment-memory.json to dry-run file on first run', () => {
    // Create old-format file
    fs.mkdirSync(path.dirname(OLD_FILE), { recursive: true });
    fs.writeFileSync(OLD_FILE, JSON.stringify([sampleRecord], null, 2));

    // DRY_RUN should migrate old file
    process.env.DRY_RUN = 'true';
    const engine = new DeploymentMemoryEngine();
    expect(engine.getHistory().length).toBe(1);
    expect(fs.existsSync(DRY_FILE)).toBe(true);
    // LIVE should NOT have read from old file
    process.env.DRY_RUN = 'false';
    const liveEngine = new DeploymentMemoryEngine();
    expect(liveEngine.getHistory().length).toBe(0);
  });
});
