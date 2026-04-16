import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface OrphanGateResult {
  orphans: string[]
  ok: boolean
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g

/**
 * Golden-rule enforcer: every `type: module` note in `knowledge/` must have
 * at least one incoming WikiLink from `maps/`.
 *
 * Walks `maps/` to collect all `[[target]]` references, then walks
 * `knowledge/` for files whose frontmatter contains `type: module`.
 * A module file whose basename (without `.md`) appears zero times in
 * the maps link set is an orphan.
 *
 * Note: links from `knowledge/` → `knowledge/` do NOT count — the
 * incoming link must come from a MOC in `maps/`.
 */
export function runOrphanGate(vaultPath: string): OrphanGateResult {
  const mapsDir = join(vaultPath, 'maps')
  const knowledgeDir = join(vaultPath, 'knowledge')

  // Collect all WikiLink targets from maps/
  const linkedFromMaps = new Set<string>()
  walkMdFiles(mapsDir, (content) => {
    for (const match of content.matchAll(WIKILINK_RE)) {
      linkedFromMaps.add(match[1].trim())
    }
  })

  // Also count `related:` frontmatter links from maps/ files
  walkMdFiles(mapsDir, (content) => {
    // Extract related array from frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) return
    const fm = fmMatch[1]
    // Simple extraction of related: ["[[x]]", "[[y]]"]
    for (const match of fm.matchAll(WIKILINK_RE)) {
      linkedFromMaps.add(match[1].trim())
    }
  })

  // Walk knowledge/ for type: module files
  const orphans: string[] = []
  walkMdFiles(knowledgeDir, (content, filename) => {
    const basename = filename.replace(/\.md$/, '')

    // Check if this is a module note
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) return
    if (!fmMatch[1].includes('type: module')) return

    // Check if it has incoming links from maps/
    if (!linkedFromMaps.has(basename)) {
      orphans.push(basename)
    }
  })

  orphans.sort()

  return { orphans, ok: orphans.length === 0 }
}

function walkMdFiles(
  dir: string,
  callback: (content: string, filename: string) => void,
): void {
  if (!existsSync(dir)) return

  const walk = (d: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const entry of entries) {
      const p = join(d, entry)
      let s
      try {
        s = statSync(p)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        walk(p)
      } else if (entry.endsWith('.md')) {
        try {
          const content = readFileSync(p, 'utf-8')
          callback(content, entry)
        } catch {
          /* skip unreadable files */
        }
      }
    }
  }
  walk(dir)
}
