/**
 * CLAUDE.md content delta — emit only when the project/user memory
 * file content changes between turns, not every turn.
 *
 * WHY: `prependUserContext` in `src/utils/api.ts` renders the CLAUDE.md
 * contents as a `<system-reminder>` user message on EVERY API call
 * (per turn AND per tool-use cycle within a turn). The memoized source
 * (`getUserContext` in `src/context.ts`) returns a stable string across
 * calls, so Anthropic/Bedrock/Vertex prompt caching covers it, but:
 *   - OpenAI / Kimi / DeepSeek / Codex use **implicit prefix caching**
 *     which benefits from byte-identical prefixes; spurious re-emission
 *     still costs one round-trip of bytes uploaded.
 *   - GitHub Copilot has no cache — each byte is billed once.
 *   - Ollama reuses its local KV cache only when the prefix is stable.
 *
 * Mirrors the pattern of:
 *   - `src/utils/mcpInstructionsDelta.ts`
 *   - `src/utils/toolSearch.ts` (`getDeferredToolsDelta`)
 *   - `src/utils/attachments.ts` (`getAgentListingDeltaAttachment`)
 *
 * Each scanner reconstructs the "announced state" by walking prior
 * attachments of the same type, compares against the current state,
 * and emits only the diff. Session history is the source of truth;
 * no external mutable state is required.
 *
 * Copy elision: returns `null` when nothing changed so the caller can
 * avoid re-emitting an attachment at all (the delta pattern's central
 * idea — the content lives in the transcript once, not N times).
 */

import { logEvent } from '../services/analytics/index.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { djb2Hash } from './hash.js'

/**
 * Key inside the system/user-context object (see `getUserContext` in
 * src/context.ts) that this delta replaces when dedup is active.
 * `api.ts::filterStaticDedupKeys` reads this to know which key to strip
 * from `prependUserContext`, avoiding double-announce.
 */
export const CLAUDE_MD_CONTEXT_KEY = 'claudeMd' as const

export type ClaudeMdDelta = {
  /**
   * The new or changed CLAUDE.md payload. Empty string means the file
   * went from non-empty to empty (explicit retraction).
   */
  addedContent: string
  /** Content hash — used by future turns to detect further drift. */
  contentHash: string
  /** True when the prior history has no claude_md_delta attachment. */
  isInitial: boolean
}

/**
 * Opt-in: OPENCLAUDE_STATIC_DEDUP=true enables the turn-delta scanners
 * across the four dedup modules (CLAUDE.md, gitStatus, nested memory,
 * todo reminders). Kept off by default to avoid regressing the current
 * always-emit path; once validated end-to-end the gate can flip.
 *
 * Mirrors the env-override pattern used by
 * `isMcpInstructionsDeltaEnabled`:
 *   - CLAUDE_CODE_MCP_INSTR_DELTA wins over any upstream gate.
 * Same semantics: truthy enables, explicit falsy disables.
 */
export function isStaticDedupEnabled(): boolean {
  if (isEnvTruthy(process.env.OPENCLAUDE_STATIC_DEDUP)) return true
  if (isEnvDefinedFalsy(process.env.OPENCLAUDE_STATIC_DEDUP)) return false
  return false
}

type ScannableMessage = {
  type: string
  attachment?: { type: string; contentHash?: string }
}

/**
 * Diff the current CLAUDE.md content against the last announced hash in
 * the conversation. Returns `null` if the content is unchanged (or if
 * there is no CLAUDE.md at all AND nothing was previously announced —
 * i.e., a true no-op).
 *
 * Pure function: all state — current content, prior transcript — is
 * passed in. No reads from globals or memoized caches.
 */
export function getClaudeMdDelta(
  currentContent: string | null | undefined,
  messages: readonly ScannableMessage[],
): ClaudeMdDelta | null {
  let lastAnnouncedHash: string | null = null
  let totalAttachmentCount = 0
  let priorClaudeMdDeltaCount = 0
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    totalAttachmentCount++
    if (msg.attachment?.type !== 'claude_md_delta') continue
    priorClaudeMdDeltaCount++
    lastAnnouncedHash = msg.attachment.contentHash ?? null
  }

  const normalized = currentContent ?? ''
  // WHY: djb2Hash is the project-standard content hash for drift
  // detection (same helper used by promptCacheBreakDetection.ts for
  // cache-bust detection). toString(36) gives a compact short string.
  const currentHash =
    normalized.length === 0 ? '' : djb2Hash(normalized).toString(36)

  // True no-op: nothing to announce, nothing was ever announced.
  if (lastAnnouncedHash === null && currentHash === '') return null
  // Unchanged from last announcement — copy elision.
  if (lastAnnouncedHash === currentHash) return null

  logEvent('tengu_claude_md_delta', {
    changed: true,
    priorAnnounced: lastAnnouncedHash !== null,
    currentLength: normalized.length,
    attachmentCount: totalAttachmentCount,
    cmdCount: priorClaudeMdDeltaCount,
  })

  return {
    addedContent: normalized,
    contentHash: currentHash,
    isInitial: lastAnnouncedHash === null,
  }
}
