/**
 * Agent Knowledge Graph — startup traversal
 *
 * Traverses the local graph and renders a structured context string that
 * replaces AGENTS.md + MEMORY.md injection. The graph IS the agent.
 */

import type { Database } from 'bun:sqlite'
import {
  getNodesByType,
  getOutgoing,
  pruneExpired,
  type KGNode,
} from './db.js'

const MAX_EXAMPLES_PER_TOOL = 3
const MAX_FACTS = 20
const MANIFEST_MODE_THRESHOLD = 32_000 // tokens — above this, use manifest

// ── Full context render ───────────────────────────────────────────────────────

/**
 * Full injection: all content inlined.
 * Used for smaller models where context pressure is less acute.
 */
export function renderFullContext(db: Database): string {
  pruneExpired(db)
  const sections: string[] = []

  // Persona
  const personas = getNodesByType(db, 'persona')
  if (personas.length > 0) {
    sections.push('## Identity\n')
    for (const p of personas) {
      sections.push(p.content)
    }
  }

  // Rules
  const rules = getNodesByType(db, 'rule')
  if (rules.length > 0) {
    sections.push('\n## Rules\n')
    for (const r of rules) {
      sections.push(`- ${r.content}`)
    }
  }

  // Tools + examples
  const tools = getNodesByType(db, 'tool')
  if (tools.length > 0) {
    sections.push('\n## Tools\n')
    for (const tool of tools) {
      sections.push(`### ${tool.label}`)
      sections.push(tool.content)

      const examples = getOutgoing(db, tool.id, 'HAS_EXAMPLE')
        .slice(0, MAX_EXAMPLES_PER_TOOL)
      if (examples.length > 0) {
        sections.push('\n**Examples:**')
        for (const { node } of examples) {
          sections.push('```')
          sections.push(node.content)
          sections.push('```')
        }
      }

      const antiExamples = getOutgoing(db, tool.id, 'HAS_ANTI_EXAMPLE')
        .slice(0, 1)
      if (antiExamples.length > 0) {
        sections.push('\n**Avoid:**')
        for (const { node } of antiExamples) {
          sections.push(`- ${node.content}`)
        }
      }
    }
  }

  // Facts (most recent, non-stale)
  const facts = getNodesByType(db, 'fact').slice(-MAX_FACTS)
  if (facts.length > 0) {
    sections.push('\n## Memory\n')
    for (const f of facts) {
      const staleFlag = f.stale ? ' ⚠stale?' : ''
      sections.push(`[m:${f.id}] ${f.label}${staleFlag}`)
    }
  }

  return sections.join('\n')
}

// ── Manifest render ───────────────────────────────────────────────────────────

/**
 * Manifest injection: IDs + one-line summaries only.
 * Used for large model sessions (arch-1, GPT-OSS) where context is precious.
 * Model calls recall(id) on demand for full content — genuinely lossless.
 */
export function renderManifest(db: Database): string {
  pruneExpired(db)
  const sections: string[] = ['## Context Manifest\n']
  sections.push('*(call `recall(id)` for full content on any entry)*\n')

  // Persona summary
  const personas = getNodesByType(db, 'persona')
  if (personas.length > 0) {
    sections.push('[identity]')
    for (const p of personas) {
      sections.push(`  [m:${p.id}] ${p.label}`)
    }
  }

  // Rules summary
  const rules = getNodesByType(db, 'rule')
  if (rules.length > 0) {
    sections.push('[rules]')
    for (const r of rules) {
      sections.push(`  [m:${r.id}] ${r.label}`)
    }
  }

  // Tools — just names + example count
  const tools = getNodesByType(db, 'tool')
  if (tools.length > 0) {
    sections.push('[tools]')
    for (const tool of tools) {
      const exCount = getOutgoing(db, tool.id, 'HAS_EXAMPLE').length
      sections.push(`  [m:${tool.id}] ${tool.label} (${exCount} examples)`)
    }
  }

  // Facts
  const facts = getNodesByType(db, 'fact').slice(-MAX_FACTS)
  if (facts.length > 0) {
    sections.push('[memory]')

    // Group by rough topic (first word of label as heuristic)
    const byTopic = new Map<string, KGNode[]>()
    for (const f of facts) {
      const topic = f.label.split(' ')[0] ?? 'general'
      if (!byTopic.has(topic)) byTopic.set(topic, [])
      byTopic.get(topic)!.push(f)
    }

    for (const [topic, nodes] of byTopic) {
      sections.push(`  [${topic}]`)
      for (const f of nodes) {
        const staleFlag = f.stale ? ' ⚠stale?' : ''
        sections.push(`    [m:${f.id}] ${f.label}${staleFlag}`)
      }
    }
  }

  return sections.join('\n')
}

// ── Recall (on-demand full retrieval) ─────────────────────────────────────────

export function recallNode(
  db: Database,
  id: string,
): string {
  // Partial ID match — allow short IDs
  const node = db
    .query(`SELECT * FROM nodes WHERE id LIKE $pattern LIMIT 1`)
    .get({ $pattern: `${id}%` }) as KGNode | undefined

  if (!node) return `[recall: no memory found for id "${id}"]`

  const lines = [
    `[m:${node.id}] ${node.label}`,
    node.stale ? '⚠ This memory may be stale.' : '',
    '',
    node.content,
  ]

  // Include related nodes
  const related = getOutgoing(db, node.id, 'RELATED_TO')
  if (related.length > 0) {
    lines.push('\nRelated:')
    for (const { node: r } of related) {
      lines.push(`  [m:${r.id}] ${r.label}`)
    }
  }

  const superseded = getOutgoing(db, node.id, 'SUPERSEDES')
  if (superseded.length > 0) {
    lines.push('\nSupersedes:')
    for (const { node: s } of superseded) {
      lines.push(`  [m:${s.id}] ${s.label} (stale)`)
    }
  }

  return lines.filter(l => l !== '').join('\n')
}
