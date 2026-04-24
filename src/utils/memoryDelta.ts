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
 * Hash is content-based (djb2Hash — project-standard drift hash; same
 * helper used by promptCacheBreakDetection.ts) — cheap and collision-
 * free enough at session scale. A path that disappears from the current
 * set is a retraction (file no longer in the resolved nested-memory
 * rules).
 */

import { logEvent } from '../services/analytics/index.js'
import { djb2Hash } from './hash.js'

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
  // Reconstruct the "last announced" map of path → contentHash by
  // folding all prior memory_delta attachments in arrival order.
  const announcedHashByPath = new Map<string, string>()
  let totalAttachmentCount = 0
  let priorMemoryDeltaCount = 0
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    totalAttachmentCount++
    if (msg.attachment?.type !== 'memory_delta') continue
    priorMemoryDeltaCount++
    const priorAddedNames = msg.attachment.addedNames ?? []
    const priorAddedHashes = msg.attachment.addedHashes ?? []
    for (let i = 0; i < priorAddedNames.length; i++) {
      const priorHash = priorAddedHashes[i] ?? ''
      announcedHashByPath.set(priorAddedNames[i]!, priorHash)
    }
    for (const priorRemovedPath of msg.attachment.removedNames ?? []) {
      announcedHashByPath.delete(priorRemovedPath)
    }
  }

  // Build the current snapshot: path → content + hash-of-content.
  const currentContentByPath = new Map<string, string>()
  const currentHashByPath = new Map<string, string>()
  for (const file of current) {
    currentContentByPath.set(file.path, file.content)
    currentHashByPath.set(file.path, djb2Hash(file.content).toString(36))
  }

  // Diff current vs announced: hashed difference → added, missing path → removed.
  const added: Array<{ name: string; content: string; hash: string }> = []
  for (const [path, content] of currentContentByPath) {
    const priorHash = announcedHashByPath.get(path)
    const currentHash = currentHashByPath.get(path)!
    if (priorHash !== currentHash) {
      added.push({ name: path, content, hash: currentHash })
    }
  }

  const removed: string[] = []
  for (const path of announcedHashByPath.keys()) {
    if (!currentContentByPath.has(path)) removed.push(path)
  }

  if (added.length === 0 && removed.length === 0) return null

  // Deterministic output — announce order is stable within a given
  // runtime locale. Matches the `localeCompare` convention used by
  // mcpInstructionsDelta; sufficient for ASCII-range paths which are
  // the common case. Strict byte-identity across heterogeneous locales
  // is not guaranteed by localeCompare and not required here.
  added.sort((a, b) => a.name.localeCompare(b.name))
  removed.sort()

  logEvent('openclaude_memory_delta', {
    addedCount: added.length,
    removedCount: removed.length,
    priorAnnouncedCount: announcedHashByPath.size,
    attachmentCount: totalAttachmentCount,
    mdCount: priorMemoryDeltaCount,
  })

  return {
    addedNames: added.map(entry => entry.name),
    addedContent: added.map(entry => entry.content),
    addedHashes: added.map(entry => entry.hash),
    removedNames: removed,
    // Use priorMemoryDeltaCount, not announcedHashByPath.size: a prior
    // delta that removed everything leaves the map empty but is NOT the
    // initial announcement. Counting deltas avoids a false "isInitial:
    // true" after a full retraction.
    isInitial: priorMemoryDeltaCount === 0,
  }
}
