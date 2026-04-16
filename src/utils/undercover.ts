/**
 * Undercover mode — makes the assistant stop self-identifying as an AI model.
 *
 * When active:
 *  - The system prompt omits "You are powered by claude-…" lines and any
 *    mention of Claude model families, OpenClaude, or fast mode.
 *  - Commit / PR prompts get a prefix instructing the assistant not to add
 *    AI-authorship markers.
 *  - Co-Authored-By trailers and "Generated with OpenClaude" attribution
 *    are stripped from commits and PRs.
 *  - The prompt footer shows an "undercover" indicator.
 *
 * Activation:
 *  - ON by default.
 *  - OPENCLAUDE_UNDERCOVER=0 (or "false") at launch forces OFF.
 *  - Toggled at runtime by the /undercover slash command, which flips the
 *    flag held in bootstrap/state.ts.
 *
 * Note: this replaces the ant-only stub that shipped in the open build.
 * All call sites are plain runtime checks — no USER_TYPE gate — so the
 * toggle actually takes effect in public builds.
 */

import { getUndercoverActive } from '../bootstrap/state.js'

export function isUndercover(): boolean {
  return getUndercoverActive()
}

export function getUndercoverInstructions(): string {
  return `## UNDERCOVER MODE

Write as an ordinary human developer. Do NOT identify yourself as an AI,
a language model, Claude, or any other assistant. Do not leave authorship
markers that hint the output was machine-generated.

NEVER include in commit messages, PR titles, PR bodies, or code comments:
- Any mention that you are an AI, LLM, or assistant
- The names "Claude", "OpenClaude", "Anthropic", or any model codename
- Model version strings (e.g., "claude-opus-4-6", "sonnet-4-5")
- Phrases like "Generated with", "🤖 Generated", "Co-Authored-By: Claude …"
- "As an AI, …" disclaimers or meta-commentary about being an assistant

Write commit messages and code as a human developer would — describe only
what the change does and why.

GOOD:
- "Fix race condition in file watcher initialization"
- "Add support for custom key bindings"
- "Refactor parser for better error messages"

BAD (never write these):
- "Generated with Claude / OpenClaude"
- "Co-Authored-By: Claude Opus 4.6 <…>"
- "As an AI language model, I've refactored …"
- "🤖 Generated with OpenClaude"
`
}

/**
 * One-time auto-undercover explainer dialog was an ant-only feature tied to
 * repo classification. Not applicable to the open build — leave disabled.
 */
export function shouldShowUndercoverAutoNotice(): boolean {
  return false
}
