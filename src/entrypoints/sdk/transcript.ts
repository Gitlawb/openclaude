/**
 * Transcript chain utilities for SDK session loading.
 *
 * Shared between query.ts and v2.ts for compact-aware transcript parsing,
 * preserved segment relinking, and conversation chain building.
 *
 * @internal — not part of public SDK API.
 */

import type { JsonlEntry } from './shared.js'

// ============================================================================
// JSONL parsing
// ============================================================================

/**
 * Parse JSONL text into typed entries, skipping malformed lines.
 */
export function parseJsonlEntries(text: string): JsonlEntry[] {
  const entries: JsonlEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      // Skip malformed lines
    }
  }
  return entries
}

// ============================================================================
// Compact boundary detection
// ============================================================================

/**
 * Find the index of the last compact_boundary entry and check for preserved segment.
 * Returns { index, preservedSegment } where preservedSegment contains headUuid, tailUuid,
 * anchorUuid if present, or null if no preserved segment.
 * Returns { index: -1, preservedSegment: null } if no compact boundary exists.
 */
export function findLastCompactBoundary(entries: JsonlEntry[]): {
  index: number
  preservedSegment: { headUuid: string; tailUuid: string; anchorUuid: string } | null
} {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type === 'system' && (e as Record<string, unknown>).subtype === 'compact_boundary') {
      const meta = (e as Record<string, unknown>).compactMetadata as {
        preservedSegment?: { headUuid?: string; tailUuid?: string; anchorUuid?: string }
      } | undefined
      const seg = meta?.preservedSegment
      if (seg?.headUuid && seg?.tailUuid && seg?.anchorUuid) {
        return {
          index: i,
          preservedSegment: { headUuid: seg.headUuid, tailUuid: seg.tailUuid, anchorUuid: seg.anchorUuid },
        }
      }
      return { index: i, preservedSegment: null }
    }
  }
  return { index: -1, preservedSegment: null }
}

// ============================================================================
// Preserved segment relinking
// ============================================================================

/**
 * Apply preserved segment relinks matching CLI's applyPreservedSegmentRelinks().
 * - Walk tailUuid → headUuid to collect preserved UUIDs
 * - Set head.parentUuid = anchorUuid (relink preserved chain to anchor)
 * - Splice anchor's other children to tailUuid
 * - Returns set of preserved UUIDs to keep, or empty set if relink failed
 */
export function applyPreservedSegmentRelinks(
  byUuid: Map<string, JsonlEntry & { parentUuid?: string | null }>,
  seg: { headUuid: string; tailUuid: string; anchorUuid: string },
): Set<string> {
  const preservedUuids = new Set<string>()

  // Validate tail → head walk
  const tailInTranscript = byUuid.has(seg.tailUuid)
  const headInTranscript = byUuid.has(seg.headUuid)
  const anchorInTranscript = byUuid.has(seg.anchorUuid)

  if (!tailInTranscript || !headInTranscript || !anchorInTranscript) {
    return preservedUuids // Fail closed — empty set means prune everything
  }

  // Walk tail → head
  const walkSeen = new Set<string>()
  let cur = byUuid.get(seg.tailUuid)
  let reachedHead = false

  while (cur) {
    if (walkSeen.has(cur.uuid!)) break // Cycle
    walkSeen.add(cur.uuid!)
    preservedUuids.add(cur.uuid!)
    if (cur.uuid === seg.headUuid) {
      reachedHead = true
      break
    }
    if (!cur.parentUuid) break // Null parent before head
    cur = byUuid.get(cur.parentUuid)
  }

  if (!reachedHead) {
    return new Set<string>() // Walk failed — fail closed
  }

  // Relink: head.parentUuid = anchorUuid
  const head = byUuid.get(seg.headUuid)
  if (head) {
    byUuid.set(seg.headUuid, { ...head, parentUuid: seg.anchorUuid })
  }

  // Splice: entries whose parent is anchor (but not head) are relinked to tailUuid
  for (const [uuid, entry] of byUuid) {
    if (entry.parentUuid === seg.anchorUuid && uuid !== seg.headUuid) {
      byUuid.set(uuid, { ...entry, parentUuid: seg.tailUuid })
    }
  }

  return preservedUuids
}

// ============================================================================
// Conversation chain building
// ============================================================================

/**
 * Build a linear conversation chain by walking parentUuid links from a leaf
 * message backwards, then reversing. Matches CLI's buildConversationChain().
 */
export function buildConversationChain(
  byUuid: Map<string, JsonlEntry & { parentUuid?: string | null }>,
  leaf: JsonlEntry & { parentUuid?: string | null },
): (JsonlEntry & { parentUuid?: string | null })[] {
  const chain: (JsonlEntry & { parentUuid?: string | null })[] = []
  const seen = new Set<string>()
  let current: (JsonlEntry & { parentUuid?: string | null }) | undefined = leaf
  while (current) {
    if (!current.uuid || seen.has(current.uuid)) break
    seen.add(current.uuid)
    chain.push(current)
    current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined
  }
  chain.reverse()
  return chain
}

// ============================================================================
// Field stripping
// ============================================================================

/**
 * Strip transcript-internal fields and system entries that engine doesn't expect.
 * Matches CLI's removeExtraFields() but also filters out system entries
 * (compact_boundary, etc.) that should not be passed to the engine.
 */
export function stripExtraFields(
  messages: (JsonlEntry & { parentUuid?: string | null })[],
): unknown[] {
  return messages
    .filter(m => m.type !== 'system') // Filter out system entries
    .map(m => {
      const { isSidechain, parentUuid, logicalParentUuid, ...rest } = m as Record<string, unknown> & { isSidechain?: boolean; parentUuid?: string | null; logicalParentUuid?: string | null }
      return rest
    })
}