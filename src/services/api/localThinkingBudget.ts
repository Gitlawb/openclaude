/**
 * Adaptive per-turn thinking budget for local reasoning models.
 *
 * Local hybrid-reasoning models (Qwen3.x via llama.cpp / vLLM / Ollama) think on
 * every request by default — including mechanical tool turns (Read, Grep, …) —
 * which adds latency, burns context with <think> blocks, and can spiral on
 * low-VRAM setups. This module classifies each outgoing turn and injects the
 * backend-specific knob that caps or suppresses thinking accordingly.
 *
 * Opt-in via the `localThinkingBudget` setting; off unless `enabled: true`.
 * Only the OpenAI-compatible shim (openaiShim.ts) calls this, gated on
 * isLocalProviderUrl — the Anthropic-native path is untouched.
 */
import type { SettingsJson } from '../../utils/settings/types.js'
import { getSettingsWithErrors } from '../../utils/settings/settings.js'
import { logForDebugging } from '../../utils/debug.js'
import { isLikelyOllamaEndpoint, isLocalProviderUrl } from './providerConfig.js'

export type LocalBackend = 'llama.cpp' | 'vllm' | 'ollama'

export type TurnType = 'afterRoutineTool' | 'normalTurn' | 'complexTurn'

export type LocalThinkingConfig = {
  backend?: LocalBackend
  endpoint?: string
  budgetTokens: Record<TurnType, number>
  complexKeywords: string[]
  maxRoutineResultTokens?: number
}

/**
 * Tools whose results are always structurally simple (paths, line matches)
 * and never need reasoning to interpret. Read/Write/Edit are excluded because
 * their results (file content) often require substantial interpretation.
 */
const ROUTINE_TOOLS = new Set(['LS', 'Glob', 'Grep'])

/**
 * Git subcommands that produce short, structural output (no patch/diff body).
 * git diff / git show without --stat produce full patches that need reasoning.
 */
const MECHANICAL_GIT_SUBCOMMANDS = /^git\s+(status|branch|stash\s+list|remote|tag|describe)\b/

/**
 * Simple shell commands whose output is predictably short or empty.
 * cat and env are excluded: cat behaves like Read; env wraps other commands
 * and must be unwrapped to inspect the real command.
 */
const MECHANICAL_SHELL_COMMANDS =
  /^(ls|ll|la|pwd|which|whoami|date|echo|printenv|dirname|basename|mkdir|touch|uname|hostname)\b/

/**
 * Strip leading `env [flags] [VAR=val ...] cmd` or bare `VAR=val ... cmd`
 * prefixes and return the underlying command. This unwrapping is necessary to
 * correctly classify commands like `env CI=1 npm test` (test runner, not
 * mechanical) vs `env PATH=... ls` (still mechanical after unwrapping).
 */
function stripEnvPrefix(command: string): string {
  const words = command.trim().split(/\s+/)
  let i = 0
  if (words[i] === 'env') {
    i++
    // skip env flags (-i, -u NAME, --) and VAR=val assignments
    while (i < words.length) {
      const w = words[i]!
      if (w === '--') {
        i++
        break
      }
      if (w.startsWith('-') || w.includes('=')) {
        i++
      } else {
        break
      }
    }
    return words.slice(i).join(' ')
  }
  // Bare leading variable assignments: VAR=val VAR2=val2 ... cmd
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) {
    i++
  }
  return i > 0 ? words.slice(i).join(' ') : command
}

/**
 * Return true when a Bash command is mechanical — its result is predictably
 * short/structural and needs no reasoning to act on.
 *
 * Conservative: any shell complexity (&&, ;, || multi-command) defaults to
 * NOT mechanical. Pipes are OK — we check only the left-hand command.
 */
export function isMechanicalBashCommand(command: string): boolean {
  const trimmed = command.trim()

  // Multi-command shells are too ambiguous — conservatively not mechanical.
  if (/&&|\|\||;/.test(trimmed)) return false

  // Check only the primary command (before any pipe), after stripping env/VAR= prefixes.
  const primary = stripEnvPrefix(trimmed.split('|')[0]!.trim())
  if (!primary) return false

  if (MECHANICAL_GIT_SUBCOMMANDS.test(primary)) return true

  // git log is mechanical only with --oneline but NOT with patch-producing flags.
  if (
    /^git\s+log\b/.test(primary) &&
    /--oneline\b/.test(primary) &&
    !/(^|\s)(-p|--patch)\b/.test(primary)
  )
    return true

  // git diff/show are mechanical only with --stat but NOT with patch-producing flags.
  if (
    /^git\s+(diff|show)\b/.test(primary) &&
    /--stat\b/.test(primary) &&
    !/(^|\s)(-p|--patch)\b/.test(primary)
  )
    return true

  if (MECHANICAL_SHELL_COMMANDS.test(primary)) return true

  return false
}

const DEFAULT_BUDGET_TOKENS: Record<TurnType, number> = {
  afterRoutineTool: 0,
  normalTurn: 1024,
  complexTurn: -1,
}

const DEFAULT_COMPLEX_KEYWORDS = [
  'architect',
  'refactor',
  'debug',
  'analyse',
  'analyze',
  'why',
  'explain',
  'design',
  'strategy',
  'migration',
  'performance',
  'security',
  'review',
]

const DEFAULT_MAX_ROUTINE_RESULT_TOKENS = 200

/**
 * Resolve the effective config from settings, filling defaults. Returns null
 * when the feature is absent or disabled — callers must treat null as "do
 * nothing" so requests stay byte-identical when unset.
 */
export function resolveLocalThinkingConfig(
  raw?: SettingsJson['localThinkingBudget'] | null,
): LocalThinkingConfig | null {
  let config: SettingsJson['localThinkingBudget']
  if (raw === undefined) {
    try {
      config = getSettingsWithErrors().effective.localThinkingBudget
    } catch {
      return null
    }
  } else {
    config = raw ?? undefined
  }
  if (!config || config.enabled !== true) {
    return null
  }
  const b = config.budgetTokens ?? {}
  return {
    backend: config.backend,
    endpoint: config.endpoint,
    budgetTokens: {
      afterRoutineTool: b.afterRoutineTool ?? DEFAULT_BUDGET_TOKENS.afterRoutineTool,
      normalTurn: b.normalTurn ?? DEFAULT_BUDGET_TOKENS.normalTurn,
      complexTurn: b.complexTurn ?? DEFAULT_BUDGET_TOKENS.complexTurn,
    },
    complexKeywords:
      config.complexKeywords && config.complexKeywords.length > 0
        ? config.complexKeywords
        : DEFAULT_COMPLEX_KEYWORDS,
    maxRoutineResultTokens: config.maxRoutineResultTokens ?? DEFAULT_MAX_ROUTINE_RESULT_TOKENS,
  }
}

/**
 * Decide whether the local thinking budget applies to this request.
 *
 * Local URLs (loopback / RFC1918 / .local) are always accepted. For non-local
 * URLs (LAN bare hostnames, split-horizon DNS) the caller must set `endpoint`
 * in the config to anchor the opt-in to a specific origin — this prevents the
 * backend-specific field injection from leaking to cloud/OpenAI-compatible
 * profiles when the user switches away from their local inference endpoint.
 */
export function shouldApplyLocalThinkingBudget(
  config: LocalThinkingConfig | null,
  baseUrl: string | undefined,
): boolean {
  if (!config) return false
  if (isLocalProviderUrl(baseUrl)) return true
  if (config.endpoint && baseUrl) {
    try {
      return new URL(config.endpoint).origin === new URL(baseUrl).origin
    } catch {
      if (!warnedInvalidEndpoint) {
        warnedInvalidEndpoint = true
        logForDebugging(
          `[localThinkingBudget] endpoint "${config.endpoint}" is not a valid URL — ` +
            'include a scheme (e.g. "http://mamachine:8080/v1"). Skipping.',
          { level: 'warn' },
        )
      }
      return false
    }
  }
  // backend set but URL is non-local and no endpoint configured — warn once so
  // users upgrading from the old "backend bypasses URL check" behaviour know
  // they need to add endpoint to their config.
  if (config.backend !== undefined && !warnedMissingEndpoint) {
    warnedMissingEndpoint = true
    logForDebugging(
      '[localThinkingBudget] backend is set but the active URL is not a local ' +
        'address and localThinkingBudget.endpoint is not configured. For LAN or ' +
        'split-horizon DNS endpoints add endpoint: "<base URL>" to your ' +
        'localThinkingBudget config. Skipping.',
      { level: 'warn' },
    )
  }
  return false
}

let warnedMissingBackend = false
let warnedMissingEndpoint = false
let warnedInvalidEndpoint = false

/** Reset module-level warning state. Test use only. */
export function _resetWarningsForTest(): void {
  warnedMissingBackend = false
  warnedMissingEndpoint = false
  warnedInvalidEndpoint = false
}

/**
 * Resolve the local backend. Explicit setting wins; otherwise Ollama is
 * auto-detected (reliable). llama.cpp and vLLM share bare localhost ports and
 * cannot be told apart passively, so an unset backend on a non-Ollama endpoint
 * returns null (feature no-ops) with a one-time warning rather than guessing
 * wrong and silently sending the wrong param shape.
 */
export function resolveLocalBackend(
  baseUrl: string,
  backendSetting: LocalBackend | undefined,
): LocalBackend | null {
  if (backendSetting) {
    return backendSetting
  }
  if (isLikelyOllamaEndpoint(baseUrl)) {
    return 'ollama'
  }
  if (!warnedMissingBackend) {
    warnedMissingBackend = true
    logForDebugging(
      '[localThinkingBudget] enabled but no backend set and endpoint is not ' +
        'Ollama; set localThinkingBudget.backend to "llama.cpp" or "vllm" to ' +
        'enable per-turn thinking control. Skipping.',
      { level: 'warn' },
    )
  }
  return null
}

type LooseBlock = {
  type?: string
  id?: string
  name?: string
  text?: string
  tool_use_id?: string
  input?: unknown
}
type LooseMessage = {
  role?: string
  message?: { role?: string; content?: unknown }
  content?: unknown
}

function asBlocks(content: unknown): LooseBlock[] {
  return Array.isArray(content) ? (content as LooseBlock[]) : []
}

type ToolUseEntry = { name: string; input: unknown }

function isRoutineToolUse(entry: ToolUseEntry): boolean {
  if (ROUTINE_TOOLS.has(entry.name)) return true
  if (entry.name === 'Bash') {
    const cmd =
      entry.input &&
      typeof entry.input === 'object' &&
      'command' in entry.input &&
      typeof (entry.input as Record<string, unknown>).command === 'string'
        ? ((entry.input as Record<string, unknown>).command as string)
        : ''
    return isMechanicalBashCommand(cmd)
  }
  return false
}

/**
 * Classify the outgoing turn by inspecting the tail of the Anthropic-shaped
 * message array:
 *   - last user message carries tool_result(s) and EVERY resolved tool is
 *     routine (LS/Glob/Grep, or Bash with a mechanical command) ⇒ afterRoutineTool
 *   - else last user text matches a complex keyword ⇒ complexTurn
 *   - else ⇒ normalTurn
 */
export function classifyTurn(
  messages: LooseMessage[],
  keywords: string[],
  maxRoutineResultTokens: number = DEFAULT_MAX_ROUTINE_RESULT_TOKENS,
): TurnType {
  // Map every tool_use id → { name, input } across assistant messages so a
  // tool_result can be resolved back to the tool that produced it.
  const toolUseById = new Map<string, ToolUseEntry>()
  for (const msg of messages) {
    const inner = msg.message ?? msg
    const role = inner.role ?? msg.role
    if (role !== 'assistant') continue
    for (const block of asBlocks(inner.content)) {
      if (block.type === 'tool_use' && block.id && block.name) {
        toolUseById.set(block.id, { name: block.name, input: block.input })
      }
    }
  }

  // Find the last user message.
  let lastUser: { content?: unknown } | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    const inner = msg.message ?? msg
    const role = inner.role ?? msg.role
    if (role === 'user') {
      lastUser = inner
      break
    }
  }
  if (!lastUser) return 'normalTurn'

  const content = lastUser.content
  const blocks = asBlocks(content)

  const toolResults = blocks.filter(b => b.type === 'tool_result')
  if (toolResults.length > 0) {
    const entries = toolResults
      .map(tr => (tr.tool_use_id ? toolUseById.get(tr.tool_use_id) : undefined))
      .filter((e): e is ToolUseEntry => Boolean(e))
    if (entries.length > 0 && entries.every(isRoutineToolUse)) {
      // Approximate token count at 4 chars/token; upgrade to normalTurn when
      // any result exceeds the threshold so large outputs get full reasoning.
      const exceedsThreshold = toolResults.some(tr => {
        const content = typeof tr.content === 'string' ? tr.content : ''
        return Math.ceil(content.length / 4) > maxRoutineResultTokens
      })
      if (!exceedsThreshold) {
        return 'afterRoutineTool'
      }
    }
  }

  // Gather user-authored text (string content, or text blocks).
  const text =
    typeof content === 'string'
      ? content
      : blocks
          .filter(b => b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text!)
          .join('\n')

  if (text) {
    const lower = text.toLowerCase()
    if (keywords.some(k => lower.includes(k.toLowerCase()))) {
      return 'complexTurn'
    }
  }

  return 'normalTurn'
}

type LooseOpenAIMessage = { role: string; content?: unknown }

function injectOllamaDirective(
  openaiMessages: LooseOpenAIMessage[],
  directive: '/think' | '/nothink',
): void {
  const first = openaiMessages[0]
  if (first && first.role === 'system' && typeof first.content === 'string') {
    // Idempotent: skip if either directive is already present (e.g. on retry).
    if (first.content.startsWith('/think') || first.content.startsWith('/nothink')) {
      first.content = `${directive}\n${first.content.replace(/^\/(?:think|nothink)\n/, '')}`
      return
    }
    first.content = `${directive}\n${first.content}`
    return
  }
  openaiMessages.unshift({ role: 'system', content: directive })
}

/**
 * Mutate the outgoing request body (and, for Ollama, the message array) to apply
 * the thinking budget for this turn on the resolved backend.
 *   - llama.cpp: thinking_budget_tokens (skip if already present — no double-inject)
 *   - vLLM:      chat_template_kwargs.enable_thinking
 *   - Ollama:    /think | /nothink directive prepended to the system message
 * On a zero budget we also strip reasoning_effort so suppression wins over the
 * static effort the shim set earlier.
 */
export function injectLocalThinkingParams(
  body: Record<string, unknown>,
  openaiMessages: LooseOpenAIMessage[],
  turnType: TurnType,
  config: LocalThinkingConfig,
  backend: LocalBackend,
): void {
  const budget = config.budgetTokens[turnType]

  switch (backend) {
    case 'llama.cpp':
      if (body.thinking_budget_tokens === undefined) {
        body.thinking_budget_tokens = budget
      }
      break
    case 'vllm': {
      const existing =
        body.chat_template_kwargs && typeof body.chat_template_kwargs === 'object'
          ? (body.chat_template_kwargs as Record<string, unknown>)
          : {}
      body.chat_template_kwargs = { ...existing, enable_thinking: budget !== 0 }
      break
    }
    case 'ollama':
      injectOllamaDirective(openaiMessages, budget === 0 ? '/nothink' : '/think')
      break
  }

  if (budget === 0) {
    delete body.reasoning_effort
  }
}
