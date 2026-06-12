import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";

const USER_CONFIG_PATH = repoPath("user-config.json");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const BASE  = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const ALLOWED_USER_IDS = new Set(
  String(process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

let chatId = null;
let _offset  = 0;
let _polling = false;
let _liveMessageDepth = 0;
let _warnedMissingChatId = false;
let _warnedMissingAllowedUsers = false;

// Message ID map for edit mirroring: dmMessageId -> channelMessageId
const _channelMsgMap = new Map();

function nonEmptyChatId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

// ─── chatId persistence ──────────────────────────────────────────
function resolveChatId() {
  const fromEnv = nonEmptyChatId(process.env.TELEGRAM_CHAT_ID);
  let fromConfig = null;
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
      fromConfig = nonEmptyChatId(cfg.telegramChatId);
    }
  } catch (error) {
    log("telegram_warn", `Invalid user-config.json; chatId not loaded: ${error.message}`);
  }
  // user-config wins when set; otherwise fall back to .env
  const resolved = fromConfig || fromEnv || null;
  return resolved != null ? String(resolved) : null;
}

function loadChatId() {
  chatId = resolveChatId();
}

function saveChatId(id) {
  try {
    let cfg = fs.existsSync(USER_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"))
      : {};
    cfg.telegramChatId = id;
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    log("telegram_error", `Failed to persist chatId: ${e.message}`);
  }
}

loadChatId();

function isAuthorizedIncomingMessage(msg) {
  const incomingChatId = String(msg.chat?.id || "");
  const senderUserId = msg.from?.id != null ? String(msg.from.id) : null;
  const chatType = msg.chat?.type || "unknown";

  if (!chatId) {
    if (!_warnedMissingChatId) {
      log("telegram_warn", "Ignoring inbound Telegram messages because TELEGRAM_CHAT_ID / user-config.telegramChatId is not configured. Auto-registration is disabled for safety.");
      _warnedMissingChatId = true;
    }
    return false;
  }

  if (incomingChatId !== String(chatId)) return false;

  if (chatType !== "private" && ALLOWED_USER_IDS.size === 0) {
    if (!_warnedMissingAllowedUsers) {
      log("telegram_warn", "Ignoring group Telegram messages because TELEGRAM_ALLOWED_USER_IDS is not configured. Set explicit allowed user IDs for command/control.");
      _warnedMissingAllowedUsers = true;
    }
    return false;
  }

  if (ALLOWED_USER_IDS.size > 0) {
    if (!senderUserId || !ALLOWED_USER_IDS.has(senderUserId)) return false;
  }

  return true;
}

// ─── Core send ───────────────────────────────────────────────────
export function isEnabled() {
  return !!TOKEN;
}

async function postTelegram(method, body) {
  if (!TOKEN || !chatId) return null;
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...body }),
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        log("telegram_error", `${method} 401 Unauthorized — check TELEGRAM_BOT_TOKEN in .env (invalid, revoked, or encrypted without .envrypt key)`);
      } else {
        log("telegram_error", `${method} ${res.status}: ${err.slice(0, 200)}`);
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    log("telegram_error", `${method} failed: ${e.message}`);
    return null;
  }
}

async function postTelegramRaw(method, body) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        log("telegram_error", `${method} 401 Unauthorized — check TELEGRAM_BOT_TOKEN in .env (invalid, revoked, or encrypted without .envrypt key)`);
      } else {
        log("telegram_error", `${method} ${res.status}: ${err.slice(0, 200)}`);
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    log("telegram_error", `${method} failed: ${e.message}`);
    return null;
  }
}

/** Send to any chat (not just the configured DM). */
async function sendToChat(chatId, method, body) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...body }),
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        log("telegram_error", `${method} 401 Unauthorized — check TELEGRAM_BOT_TOKEN`);
      } else {
        log("telegram_warn", `${method} to chat ${chatId} (${res.status}): ${err.slice(0, 200)}`);
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    log("telegram_warn", `${method} to chat ${chatId} failed: ${e.message}`);
    return null;
  }
}

export async function sendMessage(text) {
  if (!TOKEN || !chatId) return;
  return postTelegram("sendMessage", { text: String(text).slice(0, 4096) });
}

export async function sendMessageWithButtons(text, inlineKeyboard) {
  if (!TOKEN || !chatId) return;

  const truncated = String(text).slice(0, 4096);

  // Send to DM with buttons
  const dmResult = await postTelegram("sendMessage", {
    text: truncated,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });

  // Send text-only to channel if it differs from DM
  const channelId = resolveChannelId();
  if (channelId && channelId !== chatId) {
    const channelResult = await sendToChat(channelId, "sendMessage", { text: truncated });
    const channelMsgId = channelResult?.result?.message_id ?? null;
    if (dmResult?.result?.message_id) {
      _channelMsgMap.set(dmResult.result.message_id, channelMsgId);
    }
  }

  return dmResult;
}

export async function sendHTML(html) {
  if (!TOKEN || !chatId) return;
  return postTelegram("sendMessage", { text: html.slice(0, 4096), parse_mode: "HTML" });
}

let _channelNotificationLevel = "all"; // all | deploys | errors | off

export function setChannelNotificationLevel(level) {
  _channelNotificationLevel = ["all", "deploys", "errors", "off"].includes(level) ? level : "all";
}

export function getChannelNotificationLevel() {
  return _channelNotificationLevel;
}

function resolveChannelId() {
  let id = process.env.TELEGRAM_CHANNEL_ID || null;
  if (!id) {
    try {
      if (fs.existsSync(USER_CONFIG_PATH)) {
        const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
        id = cfg.telegramChannelId || null;
      }
    } catch { /* ignore */ }
  }
  return id || chatId || null;
}

/**
 * Single notification: sendMessage to bot DM and directly to channel.
 * DM always gets the message; channel gets the same text with no action buttons.
 * Message IDs are tracked so edits mirror to both.
 */
export async function notify(text, type = "info") {
  if (!TOKEN || _channelNotificationLevel === "off") return;
  if (type === "deploy" && _channelNotificationLevel === "errors") return;
  if (type === "info" && _channelNotificationLevel !== "all") return;

  if (!chatId) return;

  const truncated = String(text).slice(0, 4096);

  // Send to DM (primary chat)
  const dmResult = await postTelegram("sendMessage", { text: truncated });
  if (!dmResult?.result?.message_id) {
    log("telegram_warn", "notify: DM send returned no message_id");
    return;
  }

  // Send directly to channel if it differs from DM
  const channelId = resolveChannelId();
  if (channelId && channelId !== chatId) {
    const channelResult = await sendToChat(channelId, "sendMessage", { text: truncated });
    _channelMsgMap.set(dmResult.result.message_id, channelResult?.result?.message_id ?? null);
  } else {
    _channelMsgMap.set(dmResult.result.message_id, null);
  }

  log("telegram", `notify: ${truncated.slice(0, 80)}`);
}

/** Deprecated — use notify() instead. Kept for backwards-compat imports. */
export async function sendToChannel(text, type = "info") {
  return notify(text, type);
}

export async function editMessage(text, messageId) {
  if (!TOKEN || !chatId || !messageId) return null;

  const truncated = String(text).slice(0, 4096);

  // Edit DM
  const result = await postTelegram("editMessageText", {
    message_id: messageId,
    text: truncated,
  });

  // Mirror edit to channel
  const channelMsgId = _channelMsgMap.get(messageId);
  if (channelMsgId) {
    const channelId = resolveChannelId();
    if (channelId && channelId !== chatId) {
      await sendToChat(channelId, "editMessageText", {
        message_id: channelMsgId,
        text: truncated,
      });
    }
  }

  return result;
}

export async function editMessageWithButtons(text, messageId, inlineKeyboard) {
  if (!TOKEN || !chatId || !messageId) return null;

  const truncated = String(text).slice(0, 4096);

  // Edit DM with buttons
  const result = await postTelegram("editMessageText", {
    message_id: messageId,
    text: truncated,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });

  // Mirror edit to channel WITHOUT buttons (text only, view-only)
  const channelMsgId = _channelMsgMap.get(messageId);
  if (channelMsgId) {
    const channelId = resolveChannelId();
    if (channelId && channelId !== chatId) {
      await sendToChat(channelId, "editMessageText", {
        message_id: channelMsgId,
        text: truncated,
        // No reply_markup — channel is view-only
      });
    }
  }

  return result;
}

export async function answerCallbackQuery(callbackQueryId, text = "") {
  if (!TOKEN || !callbackQueryId) return null;
  return postTelegramRaw("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text: String(text).slice(0, 200) } : {}),
  });
}

export function hasActiveLiveMessage() {
  return _liveMessageDepth > 0;
}

function createTypingIndicator() {
  if (!TOKEN || !chatId) {
    return { stop() {} };
  }

  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    await postTelegram("sendChatAction", { action: "typing" });
    timer = setTimeout(() => {
      tick().catch(() => null);
    }, 4000);
  }

  tick().catch(() => null);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function toolLabel(name) {
  const labels = {
    get_token_info: "get token info",
    get_token_narrative: "get token narrative",
    get_token_holders: "get token holders",
    get_top_candidates: "get top candidates",
    get_pool_detail: "get pool detail",
    get_active_bin: "get active bin",
    deploy_position: "deploy position",
    close_position: "close position",
    claim_fees: "claim fees",
    swap_token: "swap token",
    update_config: "update config",
    get_my_positions: "get positions",
    get_wallet_balance: "get wallet balance",
    check_smart_wallets_on_pool: "check smart wallets",
    study_top_lpers: "study top LPers",
    get_top_lpers: "get top LPers",
    search_pools: "search pools",
    discover_pools: "discover pools",
  };
  return labels[name] || name.replace(/_/g, " ");
}

function summarizeToolResult(name, result) {
  if (!result) return "";
  if (result.error) return result.error;
  if (result.reason && result.blocked) return result.reason;
  switch (name) {
    case "deploy_position":
      return result.position ? `position ${String(result.position).slice(0, 8)}...` : "submitted";
    case "close_position":
      return result.success ? "closed" : (result.reason || "failed");
    case "claim_fees":
      return result.claimed_amount != null ? `claimed ${result.claimed_amount}` : "done";
    case "update_config":
      return Object.keys(result.applied || {}).join(", ") || "updated";
    case "get_top_candidates":
      return `${result.candidates?.length ?? 0} candidates`;
    case "get_my_positions":
      return `${result.total_positions ?? result.positions?.length ?? 0} positions`;
    case "get_wallet_balance":
      return `${result.sol ?? "?"} SOL`;
    case "study_top_lpers":
    case "get_top_lpers":
      return `${result.lpers?.length ?? 0} LPers`;
    default:
      return result.success === false ? "failed" : "done";
  }
}

export async function createLiveMessage(title, intro = "Starting...", totalSteps = 0) {
  if (!TOKEN || !chatId) return null;
  const typing = createTypingIndicator();

  const state = {
    title,
    intro,
    toolLines: [],
    footer: "",
    messageId: null,
    flushTimer: null,
    flushPromise: null,
    flushRequested: false,
    lastText: null,
    currentStep: 0,
    totalSteps,
    lastAction: null, // { label, status: "running" | "done" | "error" }
  };

  function render() {
    const sections = [state.title];

    // Step progress line
    if (state.totalSteps > 0 && state.currentStep > 0) {
      sections.push(`Step ${state.currentStep}/${state.totalSteps}`);
    }

    // Last action line
    if (state.lastAction) {
      const icon = state.lastAction.status === "running" ? "ℹ️" :
                   state.lastAction.status === "done" ? "✅" :
                   state.lastAction.status === "error" ? "❌" : "ℹ️";
      sections.push(`Last action: ${icon} ${state.lastAction.label}`);
    }

    if (state.toolLines.length > 0) sections.push(state.toolLines.join("\n"));
    if (state.footer) sections.push(state.footer);
    return sections.join("\n\n").slice(0, 4096);
  }

  async function flushNow() {
    state.flushTimer = null;
    state.flushRequested = false;
    const text = render();

    if (!state.messageId) {
      // First send — go to DM + channel, store channel mapping for edit mirroring
      const sent = await sendMessage(text);
      state.messageId = sent?.result?.message_id ?? null;
      if (state.messageId) {
        const channelId = resolveChannelId();
        if (channelId && channelId !== chatId) {
          const chResult = await sendToChat(channelId, "sendMessage", { text });
          _channelMsgMap.set(state.messageId, chResult?.result?.message_id ?? null);
        } else {
          _channelMsgMap.set(state.messageId, null);
        }
      }
      state.lastText = text;
      return;
    }

    if (text === state.lastText) return;
    state.lastText = text;
    const result = await editMessage(text, state.messageId);
    // Fallback: if edit fails (message too old / deleted), send fresh
    if (!result) {
      const sent = await sendMessage(text);
      const prevId = state.messageId;
      state.messageId = sent?.result?.message_id ?? null;
      if (state.messageId) {
        const channelId = resolveChannelId();
        if (channelId && channelId !== chatId) {
          const chResult = await sendToChat(channelId, "sendMessage", { text });
          _channelMsgMap.set(state.messageId, chResult?.result?.message_id ?? null);
        } else {
          _channelMsgMap.set(state.messageId, null);
        }
        // Clean up old mapping
        _channelMsgMap.delete(prevId);
      }
    }
  }

  function scheduleFlush(delay = 2000) {
    if (state.flushTimer) {
      state.flushRequested = true;
      return;
    }
    state.flushTimer = setTimeout(() => {
      state.flushPromise = flushNow().catch(() => null);
    }, delay);
  }

  async function upsertToolLine(name, icon, suffix = "") {
    const label = toolLabel(name);
    const line = `${icon} ${label}${suffix ? ` ${suffix}` : ""}`;
    const idx = state.toolLines.findIndex((entry) => entry.includes(` ${label}`));
    if (idx >= 0) state.toolLines[idx] = line;
    else state.toolLines.push(line);
    scheduleFlush();
  }

  _liveMessageDepth += 1;
  await flushNow();

  return {
    async toolStart(name, stepInfo) {
      if (stepInfo?.currentStep != null) {
        state.currentStep = stepInfo.currentStep;
        if (stepInfo?.totalSteps) state.totalSteps = stepInfo.totalSteps;
      }
      state.lastAction = { label: toolLabel(name), status: "running" };
      await upsertToolLine(name, "ℹ️", "...");
    },
    async toolFinish(name, result, success) {
      state.lastAction = { label: toolLabel(name), status: success ? "done" : "error" };
      const icon = success ? "✅" : "❌";
      const summary = summarizeToolResult(name, result);
      await upsertToolLine(name, icon, summary ? `— ${summary}` : "");
    },
    async setStep(currentStep, total) {
      state.currentStep = currentStep;
      if (total) state.totalSteps = total;
      scheduleFlush();
    },
    async note(text) {
      state.lastAction = null;
      scheduleFlush();
    },
    async finalize(finalText) {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      if (state.flushPromise) await state.flushPromise;
      state.lastAction = null;
      state.toolLines = [];
      state.footer = finalText;
      await flushNow();
      _liveMessageDepth = Math.max(0, _liveMessageDepth - 1);
      typing.stop();
    },
    async fail(errorText) {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      if (state.flushPromise) await state.flushPromise;
      state.lastAction = null;
      state.toolLines = [];
      state.footer = `❌ ${errorText}`;
      await flushNow();
      _liveMessageDepth = Math.max(0, _liveMessageDepth - 1);
      typing.stop();
    },
  };
}


// ─── Long polling ────────────────────────────────────────────────
async function poll(onMessage) {
  while (_polling) {
    try {
      const res = await fetch(
        `${BASE}/getUpdates?offset=${_offset}&timeout=30`,
        { signal: AbortSignal.timeout(35_000) }
      );
      if (!res.ok) { await sleep(5000); continue; }
      const data = await res.json();
      for (const update of data.result || []) {
        _offset = update.update_id + 1;
        const callback = update.callback_query;
        if (callback?.data && callback?.message) {
          const callbackMsg = {
            chat: callback.message.chat,
            from: callback.from,
            text: callback.data,
          };
          if (!isAuthorizedIncomingMessage(callbackMsg)) continue;
          await onMessage({
            ...callbackMsg,
            isCallback: true,
            callbackQueryId: callback.id,
            callbackData: callback.data,
            messageId: callback.message.message_id,
          });
          continue;
        }
        const msg = update.message;
        if (!msg?.text) continue;
        if (!isAuthorizedIncomingMessage(msg)) continue;
        await onMessage(msg);
      }
    } catch (e) {
      if (!e.message?.includes("aborted")) {
        log("telegram_error", `Poll error: ${e.message}`);
      }
      await sleep(5000);
    }
  }
}

const BOT_COMMANDS = [
  { command: "help",       description: "Show commands" },
  { command: "status",     description: "Wallet + positions snapshot" },
  { command: "wallet",     description: "Wallet, deploy amount, HiveMind status" },
  { command: "positions",  description: "List open positions" },
  { command: "pool",       description: "Detailed info for one open position" },
  { command: "close",      description: "Close one position by index" },
  { command: "closeall",   description: "Close all open positions" },
  { command: "set",        description: "Set note/instruction on position" },
  { command: "config",     description: "Show important runtime config" },
  { command: "settings",   description: "Button menu for common config" },
  { command: "setcfg",     description: "Update persisted config key" },
  { command: "screen",     description: "Refresh deterministic candidate list" },
  { command: "candidates", description: "Show latest cached candidates" },
  { command: "deploy",     description: "Deploy candidate by cached index" },
  { command: "briefing",   description: "Morning briefing" },
  { command: "hive",       description: "HiveMind sync status" },
  { command: "pause",      description: "Stop cron cycles" },
  { command: "resume",     description: "Start cron cycles again" },
  { command: "stop",       description: "Shut down agent" },
  // Phase 90 commands
  { command: "mode",       description: "Toggle DRY RUN / Live Trading" },
  { command: "filters",    description: "Show all active filters" },
  { command: "setfilter",  description: "Update filter value" },
  { command: "riskmode",   description: "Quick risk preset buttons" },
  { command: "agent",      description: "Full agent status" },
  { command: "setmodel",   description: "Change LLM model" },
  { command: "setrpc",     description: "Change RPC URL" },
  { command: "restart",    description: "Soft restart agent" },
  { command: "channel",    description: "Set channel notification level" },
];

async function registerCommands() {
  if (!BASE) return;
  try {
    await fetch(`${BASE}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    log("telegram", "Bot commands registered");
  } catch (e) {
    log("telegram_warn", `Failed to register bot commands: ${e.message}`);
  }
}

export function startPolling(onMessage) {
  if (!TOKEN) return;
  loadChatId();
  if (!chatId) {
    log("telegram_warn", "TELEGRAM_CHAT_ID not set in .env or user-config.telegramChatId — outbound notifications and inbound control disabled until configured.");
  }
  _polling = true;
  poll(onMessage); // fire-and-forget
  registerCommands();
  log("telegram", "Bot polling started");
}

export function stopPolling() {
  _polling = false;
}

// ─── Notification helpers ────────────────────────────────────────
/** Send a notification with HTML formatting (direct to both DM and channel). */
async function notifyHTML(html) {
  if (!TOKEN || _channelNotificationLevel === "off") return;
  if (!chatId) return;

  const truncated = String(html).slice(0, 4096);

  // Send to DM with HTML parse_mode
  const dmResult = await postTelegram("sendMessage", { text: truncated, parse_mode: "HTML" });
  if (!dmResult?.result?.message_id) {
    log("telegram_warn", "notifyHTML: DM send returned no message_id");
    return;
  }

  // Send directly to channel if it differs from DM
  const channelId = resolveChannelId();
  if (channelId && channelId !== chatId) {
    const channelResult = await sendToChat(channelId, "sendMessage", { text: truncated, parse_mode: "HTML" });
    _channelMsgMap.set(dmResult.result.message_id, channelResult?.result?.message_id ?? null);
  } else {
    _channelMsgMap.set(dmResult.result.message_id, null);
  }
}

export async function notifyDeploy({ pair, amountSol, position, tx, priceRange, rangeCoverage, binStep, baseFee }) {
  if (hasActiveLiveMessage()) return;
  const priceStr = priceRange
    ? `Price range: ${priceRange.min < 0.0001 ? priceRange.min.toExponential(3) : priceRange.min.toFixed(6)} – ${priceRange.max < 0.0001 ? priceRange.max.toExponential(3) : priceRange.max.toFixed(6)}\n`
    : "";
  const coverageStr = rangeCoverage
    ? `Range cover: ${fmtPct(rangeCoverage.downside_pct)} downside | ${fmtPct(rangeCoverage.upside_pct)} upside | ${fmtPct(rangeCoverage.width_pct)} total\n`
    : "";
  const poolStr = (binStep || baseFee)
    ? `Bin step: ${binStep ?? "?"}  |  Base fee: ${baseFee != null ? baseFee + "%" : "?"}\n`
    : "";
  await notifyHTML(
    `✅ <b>Deployed</b> ${pair}\n` +
    `Amount: ${amountSol} SOL\n` +
    priceStr +
    coverageStr +
    poolStr +
    `Position: <code>${position?.slice(0, 8)}...</code>\n` +
    `Tx: <code>${tx?.slice(0, 16)}...</code>`
  );
}

export async function notifyClose({ pair, pnlUsd, pnlPct }) {
  if (hasActiveLiveMessage()) return;
  const sign = pnlUsd >= 0 ? "+" : "";
  await notifyHTML(
    `🔒 <b>Closed</b> ${pair}\n` +
    `PnL: ${sign}$${(pnlUsd ?? 0).toFixed(2)} (${sign}${(pnlPct ?? 0).toFixed(2)}%)`
  );
}

export async function notifySwap({ inputSymbol, outputSymbol, amountIn, amountOut, tx }) {
  if (hasActiveLiveMessage()) return;
  await notifyHTML(
    `🔄 <b>Swapped</b> ${inputSymbol} → ${outputSymbol}\n` +
    `In: ${amountIn ?? "?"} | Out: ${amountOut ?? "?"}\n` +
    `Tx: <code>${tx?.slice(0, 16)}...</code>`
  );
}

export async function notifyOutOfRange({ pair, minutesOOR }) {
  if (hasActiveLiveMessage()) return;
  await notifyHTML(
    `⚠️ <b>Out of Range</b> ${pair}\n` +
    `Been OOR for ${minutesOOR} minutes`
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "?";
}
