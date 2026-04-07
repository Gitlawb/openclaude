/**
 * Agent Knowledge Graph — system prompt injection
 *
 * Drop-in replacement for loadMemoryPrompt(). Reads the agent's local SQLite
 * graph and returns a structured context string. Falls back to null when the
 * graph is empty (first run / no nodes seeded) so callers that gate on null
 * can degrade gracefully.
 *
 * Two rendering modes:
 *   full     — all content inlined. Good for smaller context windows.
 *   manifest — IDs + one-line summaries only. Agent calls recall(id) for full
 *              content on demand. Lossless at any context size.
 *
 * Mode selection (first match wins):
 *   1. OPENCLAUDE_KG_MODE=manifest | full
 *   2. OPENCLAUDE_KG_MANIFEST=1            (legacy compat)
 *   3. Default: full
 *
 * Agent identity:
 *   OPENCLAUDE_AGENT_ID env var, falling back to "default".
 */

import { getDb } from './db.js'
import { renderFullContext, renderManifest } from './traversal.js'

function resolveAgentId(): string {
  return process.env.OPENCLAUDE_AGENT_ID ?? 'default'
}

function resolveMode(): 'full' | 'manifest' {
  const explicit = process.env.OPENCLAUDE_KG_MODE
  if (explicit === 'manifest' || explicit === 'full') return explicit
  if (process.env.OPENCLAUDE_KG_MANIFEST === '1') return 'manifest'
  return 'full'
}

/**
 * Load the knowledge graph context for injection into the system prompt.
 * Returns null when the graph is empty so upstream callers can fall through
 * to their own defaults (matching the loadMemoryPrompt() contract).
 */
export async function loadGraphContext(): Promise<string | null> {
  try {
    const db = getDb(resolveAgentId())

    // Quick check: any nodes at all?
    const count = (
      db.query('SELECT COUNT(*) as n FROM nodes').get() as { n: number }
    ).n

    if (count === 0) return null

    const mode = resolveMode()
    const rendered = mode === 'manifest'
      ? renderManifest(db)
      : renderFullContext(db)

    // Prepend identity header when namespace is set so the agent knows
    // which graph it's running from (persona:coder, project:openclaude, etc.)
    const ns = process.env.OPENCLAUDE_KG_NAMESPACE
    const name = process.env.OPENCLAUDE_KG_NAME
    const header = ns && name ? `<!-- agent: ${ns}:${name} -->\n` : ''

    return (header + rendered).trim() || null
  } catch (err) {
    // DB unavailable (permissions, disk full, etc.) — degrade silently so a
    // storage failure never blocks the agent from starting.
    console.error('[kg] loadGraphContext failed:', err)
    return null
  }
}

/**
 * On-demand recall of a single node by (partial) ID.
 * Exposed here so tool implementations can import from one place.
 */
export { recallNode } from './traversal.js'

/**
 * Re-export DB helpers so seeders / test scripts have a single import path.
 */
export { getDb, upsertNode, upsertEdge, markStale } from './db.js'
export type { KGNode, KGEdge, NodeType, EdgeType } from './db.js'
