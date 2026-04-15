/**
 * Parser for `_conventions.md` — the vault constitution.
 *
 * Extracts a structured {@link ConventionSchema} from the canonical
 * `_conventions.md` document described in VAULT-SCHEMA.md §3–§8. The document
 * is laid out in fixed sections (schema version, frontmatter schema, tag
 * taxonomy, naming, size limits, write-time rules); this parser locates each
 * heading and pulls the structured data from the prose/lists beneath.
 *
 * Throws a clear {@link Error} when a required section is missing or a YAML
 * code block is malformed.
 */

import { parseYaml } from '../../utils/yaml.js'
import type { ConventionSchema, NoteType, TypeRules } from './defaults.js'
import { NOTE_TYPES } from './defaults.js'

const MATCHERS = {
  schemaVersion: /## Schema version\s*\n+\s*`([^`]+)`/,
  frontmatterSection: /## Frontmatter schema\s*\n([\s\S]*?)(?=\n## )/,
  tagTaxonomySection: /## Tag taxonomy\s*\n([\s\S]*?)(?=\n## )/,
  namingSection: /## Naming\s*\n([\s\S]*?)(?=\n## )/,
  sizeLimitsSection: /## Size limits\s*\n([\s\S]*?)(?=\n## |$)/,
  yamlFence: /```ya?ml\s*\n([\s\S]*?)\n```/g,
  bulletLine: /^- `([^`]+)`\s*(?:—|-)?\s*(.*)$/,
  rangeTokens: /(\d+)\s*[–-]\s*(\d+)\s*tokens/i,
  tagCountRange: /(\d+)\s*[–-]\s*(\d+)\s*tags/i,
  typePrefixLine: /^-\s*`([a-z]+)-(?:[^`]*)`\s*\(([^)]+)\)/,
  adrPrefixLine: /^-\s*`(adr)-####-<slug>\.md`\s*\(([^)]+)\)/,
} as const

function fail(section: string, detail: string): never {
  throw new Error(`parseConventions: ${section} — ${detail}`)
}

function parseSchemaVersion(md: string): string {
  const match = md.match(MATCHERS.schemaVersion)
  if (!match || !match[1]?.trim()) {
    fail('schema version', 'missing or empty `## Schema version` section')
  }
  return match[1].trim()
}

function parseFrontmatter(md: string): {
  required: string[]
  perType: Record<NoteType, string[]>
} {
  const sectionMatch = md.match(MATCHERS.frontmatterSection)
  if (!sectionMatch) {
    fail('frontmatter schema', 'missing `## Frontmatter schema` section')
  }
  const section = sectionMatch[1]

  // Validate any embedded YAML code block parses cleanly.
  MATCHERS.yamlFence.lastIndex = 0
  let fence: RegExpExecArray | null
  while ((fence = MATCHERS.yamlFence.exec(section)) !== null) {
    try {
      parseYaml(fence[1])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fail('frontmatter schema', `malformed YAML code block: ${msg}`)
    }
  }

  // Split the section into (a) the pre-"Type-specific additions" required list
  // and (b) the per-type bullets.
  const splitIdx = section.indexOf('Type-specific additions')
  const requiredBlock =
    splitIdx === -1 ? section : section.slice(0, splitIdx)
  const perTypeBlock = splitIdx === -1 ? '' : section.slice(splitIdx)

  const required: string[] = []
  for (const line of requiredBlock.split('\n')) {
    const m = line.match(MATCHERS.bulletLine)
    if (!m) continue
    const field = m[1].trim()
    const description = m[2].toLowerCase()
    // Skip enum-value bullets (e.g. under `type`) — those are values, not fields.
    // Heuristic: required-field bullets always have a description after the dash.
    if (!description) continue
    // Respect explicit "optional" markers.
    if (description.includes('optional')) continue
    // Skip obviously-non-field bullets (should not happen in canonical content).
    if (!/^[a-z_]+$/.test(field)) continue
    if (!required.includes(field)) required.push(field)
  }
  if (required.length === 0) {
    fail('frontmatter schema', 'no required fields found')
  }

  const perType: Record<NoteType, string[]> = {
    module: [],
    concept: [],
    flow: [],
    decision: [],
    incident: [],
    moc: [],
  }
  if (perTypeBlock) {
    // Each per-type bullet looks like:
    //   - **module:** `field1`, `field2`, ...
    const perTypeLine =
      /^-\s*\*\*([a-z]+):\*\*\s*(.+)$/gm
    let m: RegExpExecArray | null
    while ((m = perTypeLine.exec(perTypeBlock)) !== null) {
      const typeName = m[1] as NoteType
      if (!(NOTE_TYPES as readonly string[]).includes(typeName)) continue
      const fields = Array.from(m[2].matchAll(/`([^`]+)`/g)).map(
        (f) => f[1].trim(),
      )
      perType[typeName] = fields
    }
  }

  return { required, perType }
}

function parseTagTaxonomy(md: string): ConventionSchema['tagTaxonomy'] {
  const sectionMatch = md.match(MATCHERS.tagTaxonomySection)
  if (!sectionMatch) {
    fail('tag taxonomy', 'missing `## Tag taxonomy` section')
  }
  const section = sectionMatch[1]

  const prefixes: string[] = []
  const prefixRegex = /`([a-z]+\/)`/g
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = prefixRegex.exec(section)) !== null) {
    // Only take top-level prefix bullets, which appear at the start of a line.
    const at = m.index
    // Look back to the nearest newline; require the match to be preceded by
    // "- " (bullet) within the same line.
    const lineStart = section.lastIndexOf('\n', at) + 1
    const linePrefix = section.slice(lineStart, at)
    if (!/^\s*-\s*$/.test(linePrefix)) continue
    if (seen.has(m[1])) continue
    seen.add(m[1])
    prefixes.push(m[1])
  }
  if (prefixes.length === 0) {
    fail('tag taxonomy', 'no tag prefixes found')
  }

  const rangeMatch = section.match(MATCHERS.tagCountRange)
  if (!rangeMatch) {
    fail('tag taxonomy', 'missing tag count range (e.g. "3–7 tags")')
  }
  const minCount = Number(rangeMatch[1])
  const maxCount = Number(rangeMatch[2])

  return { prefixes, minCount, maxCount }
}

function parseNaming(md: string): ConventionSchema['naming'] {
  const sectionMatch = md.match(MATCHERS.namingSection)
  if (!sectionMatch) {
    fail('naming', 'missing `## Naming` section')
  }
  const section = sectionMatch[1]

  if (!/kebab-case/i.test(section)) {
    fail('naming', 'expected "kebab-case" declaration')
  }

  const prefixByType: Partial<Record<NoteType, string>> = {}
  // Match lines like: `- \`adr-####-<slug>.md\` (decisions)`
  //                   `- \`module-<slug>.md\` (modules)`
  const lineRegex =
    /^-\s*`([a-z]+)(?:-####)?-<slug>\.md`\s*\(([^)]+)\)/gm
  let m: RegExpExecArray | null
  while ((m = lineRegex.exec(section)) !== null) {
    const prefix = m[1]
    const label = m[2].trim().toLowerCase()
    // Map plural label → NoteType.
    const mapping: Record<string, NoteType> = {
      decisions: 'decision',
      flows: 'flow',
      concepts: 'concept',
      mocs: 'moc',
      modules: 'module',
      incidents: 'incident',
    }
    const nt = mapping[label]
    if (!nt) continue
    prefixByType[nt] = prefix === 'adr' ? 'adr-' : `${prefix}-`
  }
  // Ensure every NoteType has a prefix.
  const full: Record<NoteType, string> = {
    module: prefixByType.module ?? 'module-',
    concept: prefixByType.concept ?? 'concept-',
    flow: prefixByType.flow ?? 'flow-',
    decision: prefixByType.decision ?? 'adr-',
    incident: prefixByType.incident ?? 'incident-',
    moc: prefixByType.moc ?? 'moc-',
  }
  return { casing: 'kebab', prefixByType: full }
}

function parseSizeLimits(
  md: string,
): ConventionSchema['sizeLimits'] {
  const sectionMatch = md.match(MATCHERS.sizeLimitsSection)
  if (!sectionMatch) {
    fail('size limits', 'missing `## Size limits` section')
  }
  const section = sectionMatch[1]

  // Lines look like:
  //   - `concept` / `glossary` — 200–500 tokens
  //   - `moc` — variable (no upper cap)
  const defaults: Record<NoteType, { minTokens: number; maxTokens: number }> = {
    module: { minTokens: 0, maxTokens: 0 },
    concept: { minTokens: 0, maxTokens: 0 },
    flow: { minTokens: 0, maxTokens: 0 },
    decision: { minTokens: 0, maxTokens: 0 },
    incident: { minTokens: 0, maxTokens: 0 },
    moc: { minTokens: 0, maxTokens: Number.POSITIVE_INFINITY },
  }

  const lineRegex = /^-\s*(`[^`]+`(?:\s*\/\s*`[^`]+`)*)\s*—\s*(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = lineRegex.exec(section)) !== null) {
    const typeList = Array.from(m[1].matchAll(/`([^`]+)`/g)).map((f) => f[1])
    const rhs = m[2]
    const range = rhs.match(MATCHERS.rangeTokens)
    for (const rawType of typeList) {
      if (!(NOTE_TYPES as readonly string[]).includes(rawType)) continue
      const nt = rawType as NoteType
      if (range) {
        defaults[nt] = {
          minTokens: Number(range[1]),
          maxTokens: Number(range[2]),
        }
      } else if (/variable/i.test(rhs)) {
        defaults[nt] = {
          minTokens: 0,
          maxTokens: Number.POSITIVE_INFINITY,
        }
      }
    }
  }

  return defaults
}

/**
 * Parse the text of a `_conventions.md` document into a structured
 * {@link ConventionSchema}.
 *
 * @throws Error if any required section is missing or malformed.
 */
export function parseConventions(md: string): ConventionSchema {
  if (typeof md !== 'string' || md.trim() === '') {
    fail('input', 'expected non-empty markdown string')
  }

  const schemaVersion = parseSchemaVersion(md)
  const { required, perType } = parseFrontmatter(md)
  const tagTaxonomy = parseTagTaxonomy(md)
  const naming = parseNaming(md)
  const sizeLimits = parseSizeLimits(md)

  const noteTypes: Record<NoteType, TypeRules> = {
    module: { requiredFields: perType.module, sections: [] },
    concept: { requiredFields: perType.concept, sections: [] },
    flow: { requiredFields: perType.flow, sections: [] },
    decision: { requiredFields: perType.decision, sections: [] },
    incident: { requiredFields: perType.incident, sections: [] },
    moc: { requiredFields: perType.moc, sections: [] },
  }

  return {
    schemaVersion,
    requiredFrontmatter: required,
    noteTypes,
    tagTaxonomy,
    naming,
    sizeLimits,
  }
}
