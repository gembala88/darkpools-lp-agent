import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import { buildSystemPrompt } from "./prompt.js";
import { executeTool } from "./tools/executor.js";
import { tools } from "./tools/definitions.js";

const MANAGER_TOOLS  = new Set(["close_position", "claim_fees", "swap_token", "sweep_stuck_tokens", "get_position_pnl", "get_my_positions", "get_wallet_balance"]);
const SCREENER_TOOLS = new Set(["deploy_position", "get_active_bin", "get_top_candidates", "set_screening_profile", "check_smart_wallets_on_pool", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "get_pool_memory", "get_wallet_balance", "get_my_positions"]);
const GENERAL_INTENT_ONLY_TOOLS = new Set([
  "self_update",
  "update_config",
  "add_to_blacklist",
  "remove_from_blacklist",
  "block_deployer",
  "unblock_deployer",
  "add_pool_note",
  "set_position_note",
  "add_smart_wallet",
  "remove_smart_wallet",
  "add_lesson",
  "pin_lesson",
  "unpin_lesson",
  "clear_lessons",
  "add_strategy",
  "remove_strategy",
  "set_active_strategy",
]);

// Intent → tool subsets for GENERAL role
const INTENT_TOOLS = {
  decisions:   new Set(["get_recent_decisions"]),
  deploy:      new Set(["deploy_position", "get_top_candidates", "get_active_bin", "get_pool_memory", "check_smart_wallets_on_pool", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "get_wallet_balance", "get_my_positions", "add_pool_note"]),
  close:       new Set(["close_position", "get_my_positions", "get_position_pnl", "get_wallet_balance", "swap_token"]),
  claim:       new Set(["claim_fees", "get_my_positions", "get_position_pnl", "get_wallet_balance"]),
  swap:        new Set(["swap_token", "get_wallet_balance"]),
  config:      new Set(["update_config"]),
  blocklist:   new Set(["add_to_blacklist", "remove_from_blacklist", "list_blacklist", "block_deployer", "unblock_deployer", "list_blocked_deployers"]),
  selfupdate:  new Set(["self_update"]),
  balance:     new Set(["get_wallet_balance", "get_my_positions", "get_wallet_positions"]),
  positions:   new Set(["get_my_positions", "get_position_pnl", "get_wallet_balance", "set_position_note", "get_wallet_positions"]),
  strategy:    new Set(["list_strategies", "get_strategy", "add_strategy", "update_strategy", "delete_strategy", "remove_strategy", "set_active_strategy"]),
  screen:      new Set(["get_top_candidates", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "check_smart_wallets_on_pool", "get_pool_detail", "get_my_positions", "discover_pools"]),
  memory:      new Set(["get_pool_memory", "add_pool_note", "list_blacklist", "add_to_blacklist", "remove_from_blacklist"]),
  smartwallet: new Set(["add_smart_wallet", "remove_smart_wallet", "list_smart_wallets", "check_smart_wallets_on_pool"]),
  study:       new Set(["study_top_lpers", "get_top_lpers", "get_pool_detail", "search_pools", "get_token_info", "discover_pools", "add_smart_wallet", "list_smart_wallets"]),
  performance: new Set(["get_performance_history", "get_my_positions", "get_position_pnl"]),
  lessons:     new Set(["add_lesson", "pin_lesson", "unpin_lesson", "list_lessons", "clear_lessons"]),
};

const INTENT_PATTERNS = [
  { intent: "decisions",   re: /\b(why did you|why'd you|why was (?:this|that|it)|what made you|what was the reason|why no deploy|why didn't you deploy|why did you close|why did you deploy|why did you skip)\b/i },
  { intent: "deploy",      re: /\b(deploy|open|add liquidity|lp into|invest in)\b/i },
  { intent: "close",       re: /\b(close|exit|withdraw|remove liquidity|shut down)\b/i },
  { intent: "claim",       re: /\b(claim|harvest|collect)\b.*\bfee/i },
  { intent: "swap",        re: /\b(swap|convert|sell|exchange)\b/i },
  { intent: "selfupdate",  re: /\b(self.?update|git pull|pull latest|update (the )?bot|update (the )?agent|update yourself)\b/i },
  { intent: "blocklist",   re: /\b(blacklist|block|unblock|blocklist|blocked deployer|rugger|block dev|block deployer)\b/i },
  { intent: "config",      re: /\b(config|setting|threshold|update|set |change)\b/i },
  { intent: "balance",     re: /\b(balance|wallet|sol|how much)\b/i },
  { intent: "positions",   re: /\b(position|portfolio|open|pnl|yield|range)\b/i },
  { intent: "strategy",    re: /\b(strategy|strategies)\b/i },
  { intent: "screen",      re: /\b(screen|candidate|find pool|search|research|token)\b/i },
  { intent: "memory",      re: /\b(memory|pool history|note|remember)\b/i },
  { intent: "smartwallet", re: /\b(smart wallet|kol|whale|watch.?list|add wallet|remove wallet|list wallet|tracked wallet|check pool|who.?s in|wallets in|add to (smart|watch|kol))\b/i },
  { intent: "study",       re: /\b(study top|top lpers?|best lpers?|who.?s lping|lp behavior|lpers?)\b/i },
  { intent: "performance", re: /\b(performance|history|how.?s the bot|how.?s it doing|stats|report)\b/i },
  { intent: "lessons",     re: /\b(lesson|learned|teach|pin|unpin|clear lesson|what did you learn)\b/i },
];

function getToolsForRole(agentType, goal = "") {
  if (agentType === "MANAGER")  return tools.filter(t => MANAGER_TOOLS.has(t.function.name));
  if (agentType === "SCREENER") return tools.filter(t => SCREENER_TOOLS.has(t.function.name));

  // GENERAL: match intent from goal, combine matched tool sets
  const matched = new Set();
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(goal)) {
      for (const t of INTENT_TOOLS[intent]) matched.add(t);
    }
  }

  // Fall back to all tools if no intent matched
  if (matched.size === 0) return tools.filter(t => !GENERAL_INTENT_ONLY_TOOLS.has(t.function.name));
  return tools.filter(t => matched.has(t.function.name));
}
import { getWalletBalances } from "./tools/wallet.js";
import { getMyPositions } from "./tools/dlmm.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import { getStateSummary } from "./state.js";
import { getLessonsForPrompt, getPerformanceSummary } from "./lessons.js";
import { getDecisionSummary } from "./decision-log.js";
import { getActiveKey, handleApiError } from "./src/services/nvidiaKeyRotator.js";

const hasNvidiaKeys = !!(process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY);

// Supports OpenRouter (default) or any OpenAI-compatible local server (e.g. LM Studio)
// To use LM Studio: set LLM_BASE_URL=http://localhost:1234/v1 and LLM_API_KEY=lm-studio in .env
const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: hasNvidiaKeys ? getActiveKey() : (process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY),
  timeout: 5 * 60 * 1000,
});

const DEFAULT_MODEL = process.env.LLM_MODEL || "openrouter/healer-alpha";

const MUTATING_TOOL_INTENTS = /\b(deploy|open position|add liquidity|lp into|invest in|close|exit|withdraw|remove liquidity|claim|harvest|collect|swap|convert|sell|exchange|block|unblock|blacklist|add smart wallet|remove smart wallet|add wallet|remove wallet|pin|unpin|clear lesson|add lesson|set active strategy|remove strategy|add strategy|set |change |update |self.?update|pull latest|git pull|update yourself)\b/i;
const LIVE_DATA_TOOL_INTENTS = /\b(balance|wallet|position|portfolio|pnl|yield|range|show positions|open positions|screen|candidate|find pool|search|research|analyze|check pool|token holders|narrative|study top|top lpers?|lp behavior|who.?s lping|performance|history|stats|report|list smart wallets|list blacklist|list blocked deployers|list lessons)\b/i;
const CONFIG_READ_ONLY_INTENTS = /\b(check|show|what(?:'s| is)?|review|inspect|see)\b.*\b(config|settings?|thresholds?)\b/i;
const DECISION_EXPLANATION_INTENTS = /\b(why did you|why'd you|why was (?:this|that|it)|what made you|what was the reason|why no deploy|why didn't you deploy|why did you close|why did you deploy|why did you skip)\b/i;

function shouldRequireRealToolUse(goal, agentType, interactive = false) {
  if (agentType === "MANAGER") return false;
  if (DECISION_EXPLANATION_INTENTS.test(goal)) return false;
  if (CONFIG_READ_ONLY_INTENTS.test(goal)) return false;
  if (MUTATING_TOOL_INTENTS.test(goal)) return true;
  return interactive && LIVE_DATA_TOOL_INTENTS.test(goal);
}

function buildMessages(systemPrompt, sessionHistory, goal, providerMode = "system") {
  if (providerMode === "user_embedded") {
    return [
      ...sessionHistory,
      {
        role: "user",
        content: `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n\n[USER REQUEST]\n${goal}`,
      },
    ];
  }

  return [
    { role: "system", content: systemPrompt },
    ...sessionHistory,
    { role: "user", content: goal },
  ];
}

function isSystemRoleError(error) {
  const message = String(error?.message || error?.error?.message || error || "");
  return /invalid message role:\s*system/i.test(message);
}

function isToolChoiceRequiredError(error) {
  const message = String(error?.message || error?.error?.message || error || "");
  return /tool_choice/i.test(message) && /required/i.test(message);
}

function isThinkingModeToolChoiceError(error) {
  const message = String(error?.message || error?.error?.message || error || "");
  return /thinking mode does not support/i.test(message) && /tool_choice/i.test(message);
}

function truncateContent(str, maxLen = 2000) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...[truncated]";
}

function truncateToolResult(result, maxLen = 2000) {
  if (result == null) return result;
  if (typeof result === "string") return truncateContent(result, maxLen);
  if (typeof result === "object") {
    const copy = Array.isArray(result) ? [] : {};
    for (const [k, v] of Object.entries(result)) {
      if (typeof v === "string" && v.length > maxLen) {
        copy[k] = truncateContent(v, maxLen);
      } else if (Array.isArray(v) && v.length > 20) {
        copy[k] = v.slice(0, 20);
        copy[k + "_count"] = v.length;
        copy[k + "_truncated"] = true;
      } else if (typeof v === "object" && v !== null) {
        copy[k] = truncateToolResult(v, maxLen);
      } else {
        copy[k] = v;
      }
    }
    return copy;
  }
  return result;
}

function trimMessages(messages, maxMessages = 12) {
  if (messages.length <= maxMessages) return messages;
  // Always keep system prompt (index 0) and the user goal (index 1 or first user message)
  const systemIdx = 0;
  // Find first user message as the goal
  let goalIdx = 1;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "user") { goalIdx = i; break; }
  }
  // Keep last N-2 messages (system + goal are fixed)
  const keepTail = maxMessages - 2;
  const tailStart = Math.max(goalIdx + 1, messages.length - keepTail);
  const trimmed = [messages[systemIdx], messages[goalIdx], ...messages.slice(tailStart)];
  const dropped = messages.length - trimmed.length;
  trimmed.splice(2, 0, {
    role: "system",
    content: `[${dropped} intermediate steps trimmed to fit context window. The analysis is still in progress — continue from where you left off.]`,
  });
  return trimmed;
}

/**
 * Core ReAct agent loop.
 *
 * @param {string} goal - The task description for the agent
 * @param {number} maxSteps - Safety limit on iterations
 * @returns {string} - The agent's final text response
 */
/**
 * Detect when the LLM writes a deploy_position tool call as plain text
 * instead of using the structured tool_calls API. Extract and return it.
 */
function extractToolCallFromText(content) {
  const match = content.match(/\{\s*"name"\s*:\s*"(deploy_position)"\s*,/i);
  if (!match) return null;
  let depth = 0;
  let end = match.index;
  for (let i = match.index; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  let raw = content.slice(match.index, end);

  // Balanced-paren :round(EXPR) evaluator — handles any nesting depth
  while (/:\s*round\s*\(/i.test(raw)) {
    const rmatch = raw.match(/:\s*round\s*\(/i);
    if (!rmatch) break;
    let depth = 0;
    const startParen = rmatch.index + rmatch[0].length - 1;
    let close = -1;
    for (let i = startParen; i < raw.length; i++) {
      if (raw[i] === '(') depth++;
      else if (raw[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) break;
    const expr = raw.slice(startParen + 1, close);
    try {
      const computed = eval(expr);
      raw = raw.slice(0, rmatch.index) + `: ${Number.isFinite(computed) ? computed : 0}` + raw.slice(close + 1);
    } catch {
      raw = raw.slice(0, rmatch.index) + ': 0' + raw.slice(close + 1);
    }
  }

  // Normalize :None → :null and : undefined → :null
  raw = raw.replace(/:\s*None\b/gi, ':null');
  raw = raw.replace(/"undefined"/gi, 'null');

  try {
    const parsed = JSON.parse(jsonrepair(raw));
    if (parsed && parsed.name === "deploy_position" && parsed.parameters) {
      return { name: parsed.name, parameters: parsed.parameters };
    }
  } catch {}
  return null;
}

export async function agentLoop(goal, maxSteps = config.llm.maxSteps, sessionHistory = [], agentType = "GENERAL", model = null, maxOutputTokens = null, options = {}) {
  const { interactive = false, onToolStart = null, onToolFinish = null } = options;
  // Build dynamic system prompt with current portfolio state
  const [portfolio, positions] = await Promise.all([getWalletBalances(), getMyPositions()]);
  const stateSummary = getStateSummary();
  const lessons = getLessonsForPrompt({ agentType });
  const perfSummary = getPerformanceSummary();
  const decisionSummary = getDecisionSummary();
  let weightsSummary = null;
  if (agentType === "SCREENER") {
    try {
      const { getWeightsSummary } = await import("./signal-weights.js");
      const { config } = await import("./config.js");
      if (config.darwin?.enabled) weightsSummary = getWeightsSummary();
    } catch { /* signal-weights not critical */ }
  }
  const systemPrompt = buildSystemPrompt(agentType, portfolio, positions, stateSummary, lessons, perfSummary, weightsSummary, decisionSummary);

  let providerMode = "system";
  let messages = buildMessages(systemPrompt, sessionHistory, goal, providerMode);

  // Track write tools fired this session — prevent the model from calling the same
  // destructive tool twice (e.g. deploy twice, swap twice after auto-swap)
  const ONCE_PER_SESSION = new Set(["deploy_position", "swap_token", "close_position"]);
  // These lock after first attempt regardless of success — retrying them is always wrong
  const NO_RETRY_TOOLS = new Set(["deploy_position"]);
  const firedOnce = new Set();
  const mustUseRealTool = shouldRequireRealToolUse(goal, agentType, interactive);
  let sawToolCall = false;
  let noToolRetryCount = 0;
  // Stays true for the whole run once a thinking-mode provider rejects tool_choice
  let omitToolChoice = false;

  let emptyStreak = 0;

  // Track read-only tool call frequency — prevent loops where model re-calls get_top_candidates
  // instead of making a deploy/no-deploy decision (observed with llama-3.3-70b)
  const READONLY_TOOLS = new Set(["get_top_candidates", "get_active_bin", "get_pool_memory", "get_token_holders", "get_token_narrative", "get_token_info", "get_wallet_balance", "get_my_positions", "check_smart_wallets_on_pool", "search_pools", "discover_pools", "get_pool_detail", "get_recent_decisions", "get_performance_history"]);
  const readCallCount = new Map();
  const MAX_READ_CALLS = 2;

  for (let step = 0; step < maxSteps; step++) {
    log("agent", `Step ${step + 1}/${maxSteps}`);

    try {
      const activeModel = model || DEFAULT_MODEL;

      // Retry up to 3 times on transient provider errors (502, 503, 529)
      const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL;
      let response;
      let usedModel = activeModel;
      // Force a tool call on step 0 for action intents — prevents the model from inventing deploy/close outcomes
      const ACTION_INTENTS = /\b(deploy|open|add liquidity|close|exit|withdraw|claim|swap|block|unblock|screening|get_top_candidates)\b/i;
      let toolChoice = (step === 0 && (ACTION_INTENTS.test(goal) || mustUseRealTool || agentType === "SCREENER")) ? "required" : "auto";
      let keyRotated = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (hasNvidiaKeys) client.apiKey = getActiveKey();
          // Context window trim — keep messages bounded to prevent overflow
          messages = trimMessages(messages);
          const reqParams = {
            model: usedModel,
            messages,
            tools: getToolsForRole(agentType, goal),
            temperature: config.llm.temperature,
            max_tokens: maxOutputTokens ?? config.llm.maxTokens,
          };
          if (!omitToolChoice) reqParams.tool_choice = toolChoice;
          response = await client.chat.completions.create(reqParams);
        } catch (error) {
          // NVIDIA key rotation: max 1 rotation + retry per call
          if (hasNvidiaKeys && !keyRotated && handleApiError(error)) {
            keyRotated = true;
            log("agent", "NVIDIA key rotated — retrying once with new key");
            continue;
          }
          if (providerMode === "system" && isSystemRoleError(error)) {
            providerMode = "user_embedded";
            messages = buildMessages(systemPrompt, sessionHistory, goal, providerMode);
            log("agent", "Provider rejected system role — retrying with embedded system instructions");
            attempt -= 1;
            continue;
          }
          if (toolChoice === "required" && isToolChoiceRequiredError(error)) {
            toolChoice = "auto";
            log("agent", "Provider rejected tool_choice=required — retrying with tool_choice=auto");
            attempt -= 1;
            continue;
          }
          if (!omitToolChoice && isThinkingModeToolChoiceError(error)) {
            omitToolChoice = true;
            log("agent", "Provider thinking mode does not support tool_choice — retrying without it");
            attempt -= 1;
            continue;
          }
          // Connection/network errors — retry with backoff
          log("agent", `Connection error, retrying in ${(attempt + 1) * 5000}ms (attempt ${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
          continue;
        }
        if (!response) {
          log("agent_warn", "Empty/undefined LLM response — retrying");
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
          continue;
        }
        if (response.choices?.length) break;
        const errCode = response.error?.code;
        if (errCode === 502 || errCode === 503 || errCode === 529) {
          const wait = (attempt + 1) * 5000;
          if (attempt === 1 && usedModel !== FALLBACK_MODEL) {
            usedModel = FALLBACK_MODEL;
            log("agent", `Switching to fallback model ${FALLBACK_MODEL}`);
          } else {
            log("agent", `Provider error ${errCode}, retrying in ${wait / 1000}s (attempt ${attempt + 1}/3)`);
            await new Promise((r) => setTimeout(r, wait));
          }
        } else {
          break;
        }
      }

      if (!response?.choices?.length) {
        log("error", `API returned no choices at step ${step}: ${(response ? JSON.stringify(response) : 'undefined').slice(0, 200)}`);
        if (step === 0 || messages.length <= 2) {
          throw new Error(`API returned no choices: ${response?.error?.message || (response ? JSON.stringify(response) : 'undefined response')}`);
        }
        // Context overflow — trim aggressively and retry once before giving up
        const before = messages.length;
        messages = trimMessages(messages, 6);
        log("agent", `No choices — trimmed context from ${before} to ${messages.length} messages, retrying once`);
        try {
          const retryParams = {
            model: usedModel,
            messages,
            tools: getToolsForRole(agentType, goal),
            temperature: config.llm.temperature,
            max_tokens: maxOutputTokens ?? config.llm.maxTokens,
          };
          if (!omitToolChoice) retryParams.tool_choice = toolChoice;
          response = await client.chat.completions.create(retryParams);
        } catch { /* fall through */ }
        if (!response?.choices?.length) {
          log("agent", "No choices after context trim — finalizing cycle cleanly");
          await onToolFinish?.({ name: "__finalize__", args: {}, result: { skipped: true, reason: "Context limit reached — could not complete analysis" }, success: true, step });
          return { content: "NO DEPLOY — could not complete analysis (context limit). Will retry next cycle with fresh context.", userMessage: goal };
        }
      }
      const msg = response.choices[0].message;
      // Repair malformed tool call JSON before pushing to history —
      // the API rejects the next request if history contains invalid JSON args
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.function?.arguments) {
            try {
              JSON.parse(tc.function.arguments);
            } catch {
              try {
                const raw = tc.function.arguments.replace(/:\s*undefined\b/gi, ":null").replace(/:\s*None\b/gi, ":null");
                tc.function.arguments = JSON.stringify(JSON.parse(jsonrepair(raw)));
                log("warn", `Repaired malformed JSON args for ${tc.function.name}`);
              } catch {
                tc.function.arguments = "{}";
                log("error", `Could not repair JSON args for ${tc.function.name} — cleared to {}`);
              }
            }
          }
        }
      }
      messages.push(msg);

      // If the model didn't call any tools, it's done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Hermes sometimes returns null content — pop the empty message and retry once
        if (!msg.content) {
          messages.pop(); // remove the empty assistant message
          log("agent", "Empty response, retrying...");
          continue;
        }
        if (mustUseRealTool && !sawToolCall) {
          noToolRetryCount += 1;
          messages.pop();
          log("agent", `Rejected no-tool final answer (${noToolRetryCount}/2) for tool-required request`);
          if (noToolRetryCount >= 2) {
            return {
              content: "I couldn't complete that reliably because no tool call was made. Please retry after checking the logs.",
              userMessage: goal,
            };
          }
          messages.push({
            role: providerMode === "system" ? "system" : "user",
            content: providerMode === "system"
              ? "You have not used any tool yet. This request requires real tool execution or live tool-backed data. Do not answer from memory or inference. Call the appropriate tool first, then report only the real result."
              : "[SYSTEM REMINDER]\nYou have not used any tool yet. This request requires real tool execution or live tool-backed data. Do not answer from memory or inference. Call the appropriate tool first, then report only the real result.",
          });
          continue;
        }
        // Code-fence guard: detect code/explanation writing instead of deciding
        if (msg.content && /```|example of how|you might use|^def\s+|^import\s+|^class\s+|#.*?example/i.test(msg.content)) {
          messages.pop();
          log("agent", "Code-chatter detected — model wrote code/example instead of deciding, re-prompting once");
          messages.push({
            role: providerMode === "system" ? "system" : "user",
            content: providerMode === "system"
              ? "Do NOT write code or explanations. Either call a tool now, or give your final deploy/NO DEPLOY decision."
              : "[SYSTEM REMINDER]\nDo NOT write code or explanations. Either call a tool now, or give your final deploy/NO DEPLOY decision.",
          });
          // If we already re-prompted once and model still chatters, finalize as NO DEPLOY
          if (noToolRetryCount >= 1) {
            log("agent", "Code-chatter persisted after re-prompt — finalizing as NO DEPLOY");
            return { content: "NO DEPLOY — model failed to produce a valid decision (code chatter).", userMessage: goal };
          }
          noToolRetryCount += 1;
          continue;
        }
        log("agent", "Final answer reached");
        log("agent", msg.content);

        // LLM sometimes writes deploy_position as text instead of using structured tool_calls
        // Detect and convert it to a real tool call
        if (msg.content) {
          const extracted = extractToolCallFromText(msg.content);
          if (extracted) {
            log("agent", `Extracted text-embedded tool call: ${extracted.name}`);
            msg.tool_calls = [{
              id: `auto_${Date.now()}`,
              type: "function",
              function: { name: extracted.name, arguments: JSON.stringify(extracted.parameters) },
            }];
            sawToolCall = true;
          }
        }
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          return { content: msg.content, userMessage: goal };
        }
      }
      sawToolCall = true;

      // Execute each tool call in parallel
      const toolResults = await Promise.all(msg.tool_calls.map(async (toolCall) => {
        const functionName = toolCall.function.name.replace(/<.*$/, "").trim();
        let functionArgs;

        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          try {
            functionArgs = JSON.parse(jsonrepair(toolCall.function.arguments));
            log("warn", `Repaired malformed JSON args for ${functionName}`);
          } catch (parseError) {
            // Try once more with undefined→null fix
            try {
              const raw = toolCall.function.arguments.replace(/:\s*undefined\b/gi, ":null").replace(/:\s*None\b/gi, ":null");
              functionArgs = JSON.parse(jsonrepair(raw));
              log("warn", `Repaired JSON with undefined→null for ${functionName}`);
            } catch {
              log("error", `Failed to parse args for ${functionName}: ${parseError.message}`);
              functionArgs = {};
            }
          }
        }

        // Block once-per-session tools from firing a second time
        if (ONCE_PER_SESSION.has(functionName) && firedOnce.has(functionName)) {
          log("agent", `Blocked duplicate ${functionName} call — already executed this session`);
          await onToolFinish?.({
            name: functionName,
            args: functionArgs,
            result: { blocked: true, reason: `${functionName} already attempted this session — do not retry. If it failed, report the error and stop.` },
            success: false,
            step,
          });
          return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(truncateToolResult({ blocked: true, reason: `${functionName} already attempted this session — do not retry. If it failed, report the error and stop.` })),
          };
        }

        await onToolStart?.({ name: functionName, args: functionArgs, step });
        const result = await executeTool(functionName, functionArgs);
        await onToolFinish?.({
          name: functionName,
          args: functionArgs,
          result,
          success: result?.success !== false && !result?.error && !result?.blocked,
          step,
        });

        // Lock deploy_position after first attempt regardless of outcome — retrying is never right
        // For close/swap: only lock on success so genuine failures can be retried
        if (NO_RETRY_TOOLS.has(functionName)) firedOnce.add(functionName);
        else if (ONCE_PER_SESSION.has(functionName) && result.success === true) firedOnce.add(functionName);

        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(truncateToolResult(result)),
        };
      }));

      messages.push(...toolResults);

      // Read-only tool repetition guard — prevent model from looping on get_top_candidates
      // instead of making a deploy/no-deploy decision
      const calledTools = (msg.tool_calls || []).map(tc => tc.function.name.replace(/<.*$/, "").trim());
      for (const name of calledTools) {
        if (READONLY_TOOLS.has(name)) {
          readCallCount.set(name, (readCallCount.get(name) || 0) + 1);
        }
      }
      const getTopCount = readCallCount.get("get_top_candidates") || 0;
      if (getTopCount >= MAX_READ_CALLS && calledTools.includes("get_top_candidates")) {
        const isUrgent = getTopCount >= 3;
        log("agent", `get_top_candidates called ${getTopCount}x — ${isUrgent ? "forcing" : "nudging"} decision`);
        messages.push({
          role: providerMode === "system" ? "system" : "user",
          content: providerMode === "system"
            ? (isUrgent
              ? "CRITICAL: You have called get_top_candidates " + getTopCount + " times now. STOP. Deploy on the best candidate now or give a final NO DEPLOY decision with reasoning. Do NOT call get_top_candidates again."
              : "You already have the candidate list from a previous call. Do NOT call get_top_candidates again. Either call deploy_position on your chosen pool now, or respond with your final no-deploy decision and reason.")
            : (isUrgent
              ? "[CRITICAL INSTRUCTION]\nYou have called get_top_candidates " + getTopCount + " times now. STOP. Deploy on the best candidate now or give a final NO DEPLOY decision with reasoning. Do NOT call get_top_candidates again."
              : "[SYSTEM INSTRUCTION]\nYou already have the candidate list from a previous call. Do NOT call get_top_candidates again. Either call deploy_position on your chosen pool now, or respond with your final no-deploy decision and reason."),
        });
      }
    } catch (error) {
      log("error", `Agent loop error at step ${step}: ${error.message}`);

      // If it's a rate limit, wait and retry
      if (error.status === 429) {
        log("agent", "Rate limited, waiting 30s...");
        await sleep(30000);
        continue;
      }

      // Connection/network errors — retry the step with backoff
      if (error.message?.includes('fetch') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ETIMEDOUT') || error.message?.includes('ENOTFOUND') || error.message?.includes('network') || error.message?.includes('API returned no choices')) {
        log("agent", `Connection error at step ${step}, retrying step in 10s...`);
        await sleep(10000);
        step -= 1;
        continue;
      }

      // For other errors, break the loop
      throw error;
    }
  }

  log("agent", "Max steps reached without final answer");
  return { content: "Max steps reached. Review logs for partial progress.", userMessage: goal };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
