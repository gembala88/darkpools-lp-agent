import { Logger } from '../logging/logger.js';
import { engines } from '../engines/index.js';
import { aiEngines } from '../ai/index.js';

interface ConfigChange {
  key: string;
  path: string;
  from: unknown;
  to: unknown;
  reason: string;
}

const SAFETY_LIMITS: Record<string, { min: number; max: number }> = {
  stopLossPct: { min: -15, max: -1 },
  maxPositions: { min: 1, max: 3 },
  deployAmountSol: { min: 0.1, max: 1.0 },
  minTvl: { min: 5000, max: 500000 },
};

export class ConfigManagerService {
  private logger: Logger;
  private currentChanges: ConfigChange[] = [];
  private noChanges: string[] = [];
  private _cfg: Record<string, unknown> | null = null;

  constructor() {
    this.logger = new Logger('ConfigManager');
  }

  private async cfg(): Promise<Record<string, unknown>> {
    if (!this._cfg) {
      // @ts-expect-error config.js is outside src/, no declaration file
      const mod = await import('../../config.js');
      this._cfg = mod.config as Record<string, unknown>;
    }
    return this._cfg;
  }

  async run(): Promise<void> {
    this.currentChanges = [];
    this.noChanges = [];
    this.logger.info('Config Manager cycle starting');

    try {
      const marketRegime = await this.getMarketRegime();
      const psychology = await this.getMarketPsychology();
      const rugAvg = await this.getAvgRugProbability();
      const whaleExit = await this.getWhaleExitProbability();

      this.logger.info(`Market: ${marketRegime} | Psychology: ${psychology} | RugAvg: ${rugAvg}% | WhaleExit: ${whaleExit !== null ? whaleExit + '%' : 'N/A'}`);

      await this.adjustMaxBotHoldersPct(rugAvg);
      await this.adjustMinTvl(marketRegime);
      await this.adjustMinTokenFeesSol(marketRegime);
      await this.adjustMaxPositions(marketRegime);
      await this.adjustStopLossPct(marketRegime, whaleExit);
      await this.adjustDeployAmountSol(marketRegime);
      await this.adjustMinHolders(marketRegime);

      const validated = await this.validateWithAI(marketRegime, psychology, rugAvg);

      if (validated?.additional?.length) {
        this.logger.info(`AI suggestions: ${validated.additional.join(', ')}`);
      }

      await this.applyChanges();
      await this.notifyTelegram(marketRegime, psychology);
    } catch (err) {
      this.logger.error(`Config Manager failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async getMarketRegime(): Promise<string> {
    try {
      const result = await aiEngines.marketRegime.evaluate({ poolAddress: '', tokenMint: '' });
      return (result.metadata?.regime as string) ?? 'RANGING';
    } catch {
      return 'RANGING';
    }
  }

  private async getMarketPsychology(): Promise<string> {
    try {
      const result = await aiEngines.marketPsychology.evaluate({ poolAddress: '', tokenMint: '' });
      return (result.metadata?.psychology as string) ?? 'NEUTRAL';
    } catch {
      return 'NEUTRAL';
    }
  }

  private async getAvgRugProbability(): Promise<number> {
    try {
      const scamResult = await engines.scamDetection.evaluate({});
      const meta = scamResult.metadata as Record<string, unknown>;
      return (meta.rugProbability as number) ?? 0;
    } catch {
      return 0;
    }
  }

  private async getWhaleExitProbability(): Promise<number | null> {
    try {
      const result = await aiEngines.whaleExit.evaluate({ poolAddress: '', tokenMint: '' });
      if (result.score === 0 && result.reason?.includes('No pool address')) return null;
      return 100 - result.score;
    } catch {
      return null;
    }
  }

  private async tryChange(path: string, key: string, newValue: unknown, reason: string): Promise<boolean> {
    const current = await this.getCurrentValue(path);
    const clamped = this.applySafetyLimit(key, newValue);
    if (clamped === current) {
      this.noChanges.push(key);
      return false;
    }
    this.currentChanges.push({ key, path, from: current, to: clamped, reason });
    await this.setConfigValue(path, clamped);
    return true;
  }

  private async getCurrentValue(path: string): Promise<unknown> {
    const cfg = await this.cfg();
    const parts = path.split('.');
    let obj: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
    for (const part of parts) {
      if (!obj || typeof obj !== 'object') return undefined;
      obj = obj[part] as Record<string, unknown>;
    }
    return obj;
  }

  private async setConfigValue(path: string, value: unknown): Promise<void> {
    const cfg = await this.cfg();
    const parts = path.split('.');
    let obj: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = obj[parts[i]];
      if (!next || typeof next !== 'object') return;
      obj = next as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
  }

  private applySafetyLimit(key: string, value: unknown): unknown {
    const limit = SAFETY_LIMITS[key];
    if (!limit) return value;
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    return Math.max(limit.min, Math.min(limit.max, num));
  }

  private async adjustMaxBotHoldersPct(rugAvg: number): Promise<void> {
    let val: number;
    let reason: string;
    if (rugAvg > 50) { val = 30; reason = `rug risk ${rugAvg}% > 50 — tightening bot filter`; }
    else if (rugAvg > 20) { val = 50; reason = `rug risk ${rugAvg}% moderate — standard bot filter`; }
    else { val = 70; reason = `market clean (rug ${rugAvg}%) — relaxed bot filter`; }
    await this.tryChange('screening.maxBotHoldersPct', 'maxBotHoldersPct', val, reason);
  }

  private async adjustMinTvl(regime: string): Promise<void> {
    let val: number;
    let reason: string;
    if (regime === 'PANIC') { val = 25000; reason = 'panic regime — higher TVL threshold'; }
    else if (regime === 'DISTRIBUTION') { val = 20000; reason = 'distribution — conservative TVL'; }
    else if (regime === 'TRENDING_BULLISH') { val = 10000; reason = 'bullish trend — lower TVL bar'; }
    else { val = 10000; reason = `regime ${regime} — default TVL`; }
    await this.tryChange('screening.minTvl', 'minTvl', val, reason);
  }

  private async adjustMinTokenFeesSol(regime: string): Promise<void> {
    let val: number;
    let reason: string;
    if (regime === 'PANIC') { val = 5; reason = 'panic — very selective on fees'; }
    else if (regime === 'TRENDING_BULLISH' || regime === 'ACCUMULATION') { val = 2; reason = 'active market — lower fee bar'; }
    else { val = 0.5; reason = 'quiet market — low fee threshold'; }
    await this.tryChange('screening.minTokenFeesSol', 'minTokenFeesSol', val, reason);
  }

  private async adjustMaxPositions(regime: string): Promise<void> {
    let val: number;
    let reason: string;
    if (regime === 'PANIC' || regime === 'DISTRIBUTION') { val = 1; reason = 'bearish regime — minimize exposure'; }
    else if (regime === 'RANGING') { val = 2; reason = 'neutral regime — moderate positions'; }
    else { val = 3; reason = 'bullish regime — expand positions'; }
    await this.tryChange('risk.maxPositions', 'maxPositions', val, reason);
  }

  private async adjustStopLossPct(regime: string, whaleExit: number | null): Promise<void> {
    let val: number;
    let reason: string;
    if (whaleExit !== null && whaleExit > 70) { val = -5; reason = `whaleExit ${whaleExit}% > 70 — tight stop`; }
    else if (regime === 'PANIC') { val = -5; reason = 'panic — tight stop'; }
    else { val = -10; reason = 'default stop loss'; }
    await this.tryChange('management.stopLossPct', 'stopLossPct', val, reason);
  }

  private async adjustDeployAmountSol(regime: string): Promise<void> {
    let val: number;
    let reason: string;
    if (regime === 'PANIC') { val = 0.2; reason = 'panic — minimum deploy'; }
    else if (regime === 'DISTRIBUTION') { val = 0.3; reason = 'distribution — reduced size'; }
    else if (regime === 'TRENDING_BULLISH' || regime === 'ACCUMULATION') { val = 0.5; reason = 'bullish — standard deploy'; }
    else { val = 0.4; reason = 'default deploy amount'; }
    await this.tryChange('management.deployAmountSol', 'deployAmountSol', val, reason);
  }

  private async adjustMinHolders(regime: string): Promise<void> {
    let val: number;
    let reason: string;
    if (regime === 'PANIC') { val = 200; reason = 'panic — only established tokens'; }
    else if (regime === 'TRENDING_BULLISH' || regime === 'ACCUMULATION') { val = 100; reason = 'bullish — lower holder bar'; }
    else { val = 100; reason = 'default minimum holders'; }
    await this.tryChange('screening.minHolders', 'minHolders', val, reason);
  }

  private async validateWithAI(regime: string, psychology: string, rugAvg: number): Promise<{ additional: string[] } | null> {
    const apiKey = process.env.CONFIG_MANAGER_API_KEY || process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    const model = process.env.CONFIG_MANAGER_MODEL || 'meta/llama-3.1-8b-instruct';
    const baseURL = process.env.CONFIG_MANAGER_BASE_URL || 'https://integrate.api.nvidia.com/v1';

    if (!apiKey) {
      this.logger.info('No CONFIG_MANAGER_API_KEY set, skipping AI validation');
      return null;
    }

    const changesDesc = this.currentChanges.map(c => `  - ${c.key}: ${c.from} → ${c.to} (${c.reason})`).join('\n');

    const prompt = `Given market regime "${regime}", psychology "${psychology}", recent scam rate ${rugAvg}%, validate these config changes and suggest any additional adjustments.

Changes proposed:
${changesDesc || '  (none — all values already optimal)'}

Safety rules (ALWAYS enforce):
- stopLossPct cannot be wider than -15%
- maxPositions cannot exceed 3
- deployAmountSol cannot exceed 1.0 SOL
- minTvl cannot be below 5000
- Never change: strategy, indicators, chartIndicators, hiveMind, dryRun, wallet/RPC/API keys

Respond in JSON only: {"approved": true/false, "additional": ["suggestion1", "suggestion2"]}`;

    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ baseURL, apiKey, timeout: 30_000 });
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
      });
      const text = response.choices?.[0]?.message?.content?.trim() ?? '{}';
      const clean = text.replace(/```json|```/gi, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object found in AI response');
      const parsed = JSON.parse(jsonMatch[0]);
      this.logger.info(`AI validation result: OK`);
      return { additional: Array.isArray(parsed?.additional) ? parsed.additional : [] };
    } catch (err) {
      this.logger.warn(`AI validation result: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async applyChanges(): Promise<void> {
    if (this.currentChanges.length === 0) {
      this.logger.info('No config changes needed');
      return;
    }

    const { default: fs } = await import('fs');
    const { default: path } = await import('path');
    // @ts-expect-error config.js is outside src/, no declaration file
    const mod = await import('../../config.js');
    const { repoPath, reloadScreeningThresholds } = mod;

    const configPath = repoPath('user-config.json');
    let currentJson: Record<string, unknown> = {};
    try { currentJson = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* start fresh */ }

    const historyDir = repoPath('data');
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
    const historyPath = path.join(historyDir, 'config-history.json');
    try {
      const history: Array<{ timestamp: string; changes: ConfigChange[] }> = fs.existsSync(historyPath)
        ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
        : [];
      history.push({ timestamp: new Date().toISOString(), changes: [...this.currentChanges] });
      fs.writeFileSync(historyPath, JSON.stringify(history.slice(-50), null, 2));
    } catch { /* ignore */ }

    for (const change of this.currentChanges) {
      currentJson[change.key] = change.to;
      this.logger.info(`changed ${change.key}: ${change.from} → ${change.to} (${change.reason})`);
    }

    fs.writeFileSync(configPath, JSON.stringify(currentJson, null, 2));
    reloadScreeningThresholds();
  }

  private async notifyTelegram(regime: string, psychology: string): Promise<void> {
    // @ts-expect-error telegram.js is outside src/, no declaration file
    const tg = await import('../../telegram.js');
    const sendMessage = tg.sendMessage;

    const lines: string[] = [];
    lines.push('🤖 Config Manager Update');
    lines.push(`Market: ${regime} | Psychology: ${psychology}`);

    if (this.currentChanges.length > 0) {
      lines.push('');
      lines.push(`Changes made (${this.currentChanges.length}):`);
      for (const c of this.currentChanges) {
        lines.push(`- ${c.key}: ${c.from} → ${c.to} (${c.reason})`);
      }
    }

    if (this.noChanges.length > 0) {
      lines.push('');
      lines.push(`No changes needed for: ${this.noChanges.join(', ')}`);
    }

    if (this.currentChanges.length === 0) {
      lines.push('No changes needed — current settings are optimal for market conditions.');
    }

    const hours = Number(process.env.CONFIG_MANAGER_INTERVAL_HOURS || 2);
    lines.push('');
    lines.push(`Next review: in ${hours} hours`);

    try {
      await sendMessage(lines.join('\n'));
    } catch { /* ignore */ }
  }
}
