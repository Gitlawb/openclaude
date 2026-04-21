/**
 * Nested-memory content delta — announce only the memory files whose
 * content changed (or are new / removed) between turns.
 *
 * WHY: `getNestedMemoryAttachments` (src/utils/attachments.ts) today
 * emits a fresh `nested_memory` attachment per trigger per turn, each
 * rendered into a `<system-reminder>` user message. The file contents
 * are usually stable for long stretches of a session — re-emitting
 * them every turn burns tokens on payload-billed providers (Copilot)
 * and misses implicit prefix caching (OpenAI / Kimi / DeepSeek / Codex)
 * because the rest of the prefix drifts around them.
 *
 * Mirrors the pattern of:
 *   - `src/utils/mcpInstructionsDelta.ts`
 *   - `src/utils/toolSearch.ts` (`getDeferredToolsDelta`)
 *   - `src/utils/attachments.ts` (`getAgentListingDeltaAttachment`)
 *
 * Scan prior `memory_delta` attachments → reconstruct {path → hash} →
 * compare with current {path → content} → emit {addedNames,
 * addedContent, removedNames}.
 *
 * Hash is content-based (fnv1a32) — cheap and collision-free enough at
 * session scale. A path that disappears from the current set is a
 * retraction (file no longer in the resolved nested-memory rules).
 */

import { logEvent } from '../services/analytics/index.js'
import { fnv1a32 } from './stableStringify.js'

export type MemoryDelta = {
  /** Paths newly announced OR whose content changed since last turn. */
  addedNames: string[]
  /** Rendered blocks for addedNames (same order). */
  addedContent: string[]
  /** Hash of each added block — future turns diff against this. */
  addedHashes: string[]
  /** Paths that were previously announced but are no longer present. */
  removedNames: string[]
  /** True when this is the first announcement in the session. */
  isInitial: boolean
}

/**
 * Current memory file to compare against prior deltas. Path is the
 * stable key (CLAUDE.md at a given directory); content is the current
 * rendered body (may already include the header/decoration the caller
 * wants the model to see).
 */
export type MemoryFileInput = {
  path: string
  content: string
}

type ScannableMessage = {
  type: string
  attachment?: {
    type: string
    addedNames?: string[]
    addedHashes?: string[]
    removedNames?: string[]
  }
}

/**
 * Diff current nested-memory files against what was previously
 * announced in the transcript. Returns `null` when nothing changed —
 * copy elision for the attachment pipeline.
 *
 * Pure function: all state is passed in. Content is treated as opaque
 * for hashing; the caller chooses whether to hash rendered bytes
 * (preferred: catches formatting drift) or raw file content.
 */
export function getMemoryDelta(
  current: readonly MemoryFileInput[],
  messages: readonly ScannableMessage[],
): MemoryDelta | null {
  const announced = new Map<string, string>()
  let attachmentCount = 0
  let mdCount = 0
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    attachmentCount++
    if (msg.attachment?.type !== 'memory_delta') continue
    mdCount++
    const names = msg.attachment.addedNames ?? []
    const hashes = msg.attachment.addedHashes ?? []
    for (let i = 0; i < names.length; i++) {
      const h = hashes[i] ?? ''
      announced.set(names[i]!, h)
    }
    for (const n of msg.attachment.removedNames ?? []) {
      announced.delete(n)
    }
  }

  const currentMap = new Map<string, string>()
  const currentHashes = new Map<string, string>()
  for (const f of current) {
    currentMap.set(f.path, f.content)
    currentHashes.set(f.path, fnv1a32(f.content))
  }

  const added: Array<{ name: string; content: string; hash: string }> = []
  for (const [path, content] of currentMap) {
    const prior = announced.get(path)
    const cur = currentHashes.get(path)!
    if (prior !== cur) {
      added.push({ name: path, content, hash: cur })
    }
  }

  const removed: string[] = []
  for (const path of announced.keys()) {
    if (!currentMap.has(path)) removed.push(path)
  }

  if (added.length === 0 && removed.length === 0) return null

  // Deterministic output — announce order must be stable across runs
  // to preserve byte-identical prefixes for implicit prefix caching.
  added.sort((a, b) => a.name.localeCompare(b.name))
  removed.sort()

  logEvent('tengu_memory_delta', {
    addedCount: added.length,
    removedCount: removed.length,
    priorAnnouncedCount: announced.size,
    attachmentCount,
    mdCount,
  })

  return {
    addedNames: added.map(a => a.name),
    addedContent: added.map(a => a.content),
    addedHashes: added.map(a => a.hash),
    removedNames: removed,
    isInitial: announced.size === 0,
  }
}
