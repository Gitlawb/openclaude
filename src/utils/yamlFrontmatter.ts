/**
 * Canonical YAML frontmatter serializer.
 *
 * Emits a `---`-delimited YAML block with fields in the canonical order
 * defined by VAULT-SCHEMA.md §3. Unknown fields are appended after the
 * canonical set, sorted alphabetically. Round-trips with `parseFrontmatter`.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yamlModule = require('yaml') as typeof import('yaml')

/**
 * Canonical field order for vault note frontmatter.
 * Matches VAULT-SCHEMA.md §3 (mandatory minimum + type-specific extensions).
 */
export const FRONTMATTER_FIELD_ORDER: readonly string[] = [
  // Mandatory minimum schema
  'title',
  'type',
  'tags',
  'aliases',
  'status',
  'created',
  'updated',
  'confidence',
  'summary',
  'related',
  // module
  'source_path',
  'language',
  'layer',
  'domain',
  'depends_on',
  'depended_by',
  'exports',
  'last_verified',
  // decision (ADR)
  'decision_makers',
  'supersedes',
  'superseded_by',
  // flow
  'trigger',
  'participants',
  // incident
  'severity',
  'date_occurred',
  'date_resolved',
  'duration_minutes',
  'root_cause',
  'affected_modules',
  // provenance
  'source',
]

/**
 * Serialize a frontmatter object to a canonical `---`-fenced YAML block.
 *
 * @param fm - Frontmatter object.
 * @returns String beginning and ending with `---\n`, fields in canonical order.
 */
export function serializeFrontmatter(fm: Record<string, unknown>): string {
  const canonicalSet = new Set(FRONTMATTER_FIELD_ORDER)
  const ordered: Record<string, unknown> = {}

  // 1. Canonical fields in canonical order.
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (key in fm) {
      ordered[key] = fm[key]
    }
  }

  // 2. Unknown fields appended alphabetically.
  const unknown = Object.keys(fm)
    .filter(k => !canonicalSet.has(k))
    .sort()
  for (const key of unknown) {
    ordered[key] = fm[key]
  }

  // Empty object → valid empty block.
  if (Object.keys(ordered).length === 0) {
    return '---\n---\n'
  }

  // `yaml.stringify` with defaultStringType='QUOTE_DOUBLE' would over-quote.
  // Use defaults — the parser library auto-quotes values containing YAML
  // special chars like `[[wikilinks]]`.
  const body = yamlModule.stringify(ordered, {
    lineWidth: 0, // never wrap long strings
  })

  return `---\n${body}---\n`
}
