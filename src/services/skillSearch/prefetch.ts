// Stub — skillSearch not included in source snapshot (feature-gated).
// All call sites are behind feature('EXPERIMENTAL_SKILL_SEARCH').
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import type { Attachment } from '../../utils/attachments.js'

/** Opaque handle for an in-flight skill-discovery prefetch. */
export type SkillDiscoveryPrefetch = {
  promise: Promise<Attachment[]>
}

/**
 * Kick off inter-turn skill discovery while the model streams. Inert:
 * returns null (no prefetch started), which callers treat as "nothing
 * pending".
 */
export function startSkillDiscoveryPrefetch(
  _input: string | null,
  _messages: Message[],
  _context: ToolUseContext,
): SkillDiscoveryPrefetch | null {
  return null
}

/** Collect the results of a prefetch started above. Always empty here. */
export async function collectSkillDiscoveryPrefetch(
  _pending: SkillDiscoveryPrefetch,
): Promise<Attachment[]> {
  return []
}

/**
 * Blocking turn-0 skill discovery from the user's input. Always empty here.
 */
export async function getTurnZeroSkillDiscovery(
  _input: string | null,
  _messages: Message[],
  _context: ToolUseContext,
): Promise<Attachment[]> {
  return []
}
