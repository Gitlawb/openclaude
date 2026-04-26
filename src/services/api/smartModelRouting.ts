/**
 * Smart model routing — cheap-for-simple, strong-for-hard.
 *
 * For everyday short chatter ("ok", "thanks", "what does this do?") the
 * incremental quality of Opus/GPT-5 over Haiku/Mini is negligible while the
 * cost and latency are an order of magnitude worse. Smart routing opts a
 * user into routing such "obviously simple" turns to a cheaper model while
 * keeping the strong model for the anything-non-trivial path.
 *
 * This module is a pure primitive: it takes a turn description (the user's
 * text + light context) and returns which model to use, based on config.
 * It never reads env vars or state directly — caller supplies everything.
 *
 * Off by default. Users opt in via settings.smartRouting.enabled. Intent:
 * make this a copy-paste-small config block rather than a hidden heuristic,
 * so the tradeoff is visible and the user controls it.
 */

export type SmartRoutingConfig = {
  enabled: boolean
  /** Model to use for turns classified as "simple". */
  simpleModel: string
  /** Model to use for turns classified as "strong" (or when unsure). */
  strongModel: string
  /** Max characters in user input to qualify as "simple". Default 160. */
  simpleMaxChars?: number
  /** Max whitespace-separated words to qualify as "simple". Default 28. */
  simpleMaxWords?: number
}

export type RoutingDecision = {
  model: string
  complexity: 'simple' | 'strong'
  /** Human-readable reason — useful for the UI indicator and debug logs. */
  reason: string
}

export type RoutingInput = {
  /** The user's message text for this turn. */
  userText: string
  /**
   * Optional: how many tool-use blocks the assistant has emitted in the
   * recent conversation. High values correlate with "continue this work"
   * follow-ups that can still be cheap, UNLESS the user also typed code
   * or strong-keyword text.
   */
  recentToolUses?: number
  /**
   * Optional: turn number within the current session (1-indexed). The first
   * turn is often task-setup and benefits from the strong model even if
   * short — a bare "build X" opens the whole task.
   */
  turnNumber?: number
}

const DEFAULT_SIMPLE_MAX_CHARS = 160
const DEFAULT_SIMPLE_MAX_WORDS = 28

// Keywords that strongly suggest reasoning/planning/design work.
// Matching is word-boundary / case-insensitive. Must include enough anchors
// that short prompts like "plan the refactor" route to strong even under
// the char/word cutoff.
const STRONG_KEYWORDS = [
  'plan',
  'design',
  'architect',
  'architecture',
  'refactor',
  'debug',
  'investigate',
  'analyze',
  'analyse',
  'implement',
  'optimize',
  'optimise',
  'review',
  'audit',
  'diagnose',
  'root cause',
  'root-cause',
  'why does',
  'why is',
  'how should',
  'why did',
  'propose',
  'trace',
  'reproduce',
]

const STRONG_KEYWORD_RE = new RegExp(
  `\\b(?:${STRONG_KEYWORDS.map(k => k.replace(/[-]/g, '[-\\s]')).join('|')})\\b`,
  'i',
)

const CODE_FENCE_RE = /```[\s\S]*?```|`[^`\n]+`/

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function hasMultiParagraph(text: string): boolean {
  return /\n\s*\n/.test(text)
}

function hasCode(text: string): boolean {
  return CODE_FENCE_RE.test(text)
}

function hasStrongKeyword(text: string): boolean {
  return STRONG_KEYWORD_RE.test(text)
}

/**
 * Decide whether to route to the simple or strong model based on heuristics.
 * Returns the chosen model + a reason. When routing is disabled or both
 * models match, the strong model is used (safe default).
 */
export function routeModel(
  input: RoutingInput,
  config: SmartRoutingConfig,
): RoutingDecision {
  if (!config.enabled) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: 'smart-routing disabled',
    }
  }
  if (!config.simpleModel || !config.strongModel) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: 'simpleModel or strongModel missing from config',
    }
  }
  if (config.simpleModel === config.strongModel) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: 'simpleModel equals strongModel',
    }
  }

  const text = input.userText ?? ''
  const trimmed = text.trim()

  if (!trimmed) {
    // Empty input (e.g. resuming a tool-use chain) — cheap by default.
    return {
      model: config.simpleModel,
      complexity: 'simple',
      reason: 'empty user text',
    }
  }

  // First turn of a session is task-setup — always use strong.
  if (input.turnNumber === 1) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: 'first turn of session',
    }
  }

  const maxChars = config.simpleMaxChars ?? DEFAULT_SIMPLE_MAX_CHARS
  const maxWords = config.simpleMaxWords ?? DEFAULT_SIMPLE_MAX_WORDS

  if (hasCode(trimmed)) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: 'contains code block or inline code',
    }
  }

  if (hasStrongKeyword(trimmed)) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: 'contains reasoning/planning keyword',
    }
  }

  if (hasMultiParagraph(trimmed)) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: 'multi-paragraph input',
    }
  }

  if (trimmed.length > maxChars) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: `input > ${maxChars} chars`,
    }
  }

  if (countWords(trimmed) > maxWords) {
    return {
      model: config.strongModel,
      complexity: 'strong',
      reason: `input > ${maxWords} words`,
    }
  }

  return {
    model: config.simpleModel,
    complexity: 'simple',
    reason: `short (${trimmed.length} chars, ${countWords(trimmed)} words)`,
  }
}
