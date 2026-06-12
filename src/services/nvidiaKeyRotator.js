import { log } from "../../logger.js";

let keys = [];
let currentIndex = 0;
let keyStates = [];

function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 2) + '****' + key.slice(-4);
}

function init() {
  const csv = process.env.NVIDIA_API_KEYS;
  if (csv) {
    keys = csv.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }
  if (keys.length === 0 && process.env.NVIDIA_API_KEY) {
    keys = [process.env.NVIDIA_API_KEY];
  }
  keyStates = keys.map(k => ({ key: k, cooldownUntil: 0, errorCount: 0, lastUsed: 0 }));
  if (keys.length > 0) {
    log("nvidia_rotator", `Initialized with ${keys.length} key(s) — ${maskKey(keys[0])}${keys.length > 1 ? ` (+${keys.length - 1} more)` : ''}`);
  }
}

function rotateToNextAvailable() {
  const now = Date.now();
  for (let i = 1; i <= keys.length; i++) {
    const idx = (currentIndex + i) % keys.length;
    if (keyStates[idx].cooldownUntil <= now) {
      currentIndex = idx;
      return;
    }
  }
  currentIndex = (currentIndex + 1) % keys.length;
}

export function getActiveKey() {
  if (keys.length === 0) init();
  if (keys.length === 0) return process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || null;

  const now = Date.now();
  if (keyStates[currentIndex].cooldownUntil <= now) {
    keyStates[currentIndex].lastUsed = now;
    return keyStates[currentIndex].key;
  }

  rotateToNextAvailable();
  if (keyStates[currentIndex].cooldownUntil > now) {
    const earliest = Math.min(...keyStates.map(s => s.cooldownUntil));
    log("nvidia_rotator", `All ${keys.length} keys in cooldown — earliest expires at ${new Date(earliest).toISOString()}`);
  }
  keyStates[currentIndex].lastUsed = now;
  return keyStates[currentIndex].key;
}

export function handleApiError(error) {
  if (keys.length === 0) return false;
  const status = error?.status || error?.response?.status || error?.error?.code || 0;
  const isKeyError = status === 429 || status === 401 || status === 403;
  if (!isKeyError) return false;

  const failedIdx = currentIndex;
  const state = keyStates[failedIdx];
  const now = Date.now();

  if (status === 429) {
    state.cooldownUntil = now + 60000;
    log("nvidia_rotator", `Key ${maskKey(state.key)} rate limited (429) — cooling down 60s`);
  } else {
    state.errorCount++;
    state.cooldownUntil = now + 120000;
    log("nvidia_rotator", `Key ${maskKey(state.key)} auth error (${status}) — cooling down 120s`);
  }

  rotateToNextAvailable();
  log("nvidia_rotator", `Rotated to key ${maskKey(keyStates[currentIndex].key)}`);
  return true;
}

export function getStats() {
  if (keys.length === 0) init();
  return {
    totalKeys: keys.length,
    activeIndex: keys.length > 0 ? currentIndex : -1,
    activeKey: keys.length > 0 ? maskKey(keys[currentIndex]) : 'none',
    keyStates: keyStates.map((s, i) => ({
      index: i,
      masked: maskKey(s.key),
      cooldownUntil: s.cooldownUntil,
      coolingDown: s.cooldownUntil > Date.now(),
      errorCount: s.errorCount,
      lastUsed: s.lastUsed,
    })),
  };
}

init();
