/**
 * Tests for `_conventions.md` parser.
 * See .specs/features/vault-bootstrap/tasks.md T3.
 */

import { describe, test, expect } from 'bun:test'
import { parseConventions } from './parser.js'
import { CONVENTIONS_MD_DEFAULT, SCHEMA_VERSION } from './defaults.js'

describe('parseConventions - canonical content', () => {
  test('parses CONVENTIONS_MD_DEFAULT losslessly into a fully-populated ConventionSchema', () => {
    const schema = parseConventions(CONVENTIONS_MD_DEFAULT)

    // Every top-level field must be non-empty.
    expect(schema.schemaVersion).toBe(SCHEMA_VERSION)
    expect(schema.requiredFrontmatter.length).toBeGreaterThan(0)
    expect(Object.keys(schema.noteTypes).length).toBeGreaterThan(0)
    expect(schema.tagTaxonomy.prefixes.length).toBeGreaterThan(0)
    expect(schema.tagTaxonomy.minCount).toBeGreaterThan(0)
    expect(schema.tagTaxonomy.maxCount).toBeGreaterThanOrEqual(
      schema.tagTaxonomy.minCount,
    )
    expect(schema.naming.casing).toBe('kebab')
    expect(Object.keys(schema.naming.prefixByType).length).toBeGreaterThan(0)
    expect(Object.keys(schema.sizeLimits).length).toBeGreaterThan(0)
  })

  test('requiredFrontmatter matches VAULT-SCHEMA §3 mandatory-minimum fields', () => {
    const schema = parseConventions(CONVENTIONS_MD_DEFAULT)
    // The canonical text marks `aliases` and `related` as optional, so the
    // truly required set is the 8 non-optional fields from §3.
    const expected = [
      'title',
      'type',
      'tags',
      'status',
      'created',
      'updated',
      'confidence',
      'summary',
    ]
    for (const field of expected) {
      expect(schema.requiredFrontmatter).toContain(field)
    }
    // No `aliases` or `related` — both marked optional.
    expect(schema.requiredFrontmatter).not.toContain('aliases')
    expect(schema.requiredFrontmatter).not.toContain('related')
  })

  test('extracts module and concept note types with correct requiredFields', () => {
    const schema = parseConventions(CONVENTIONS_MD_DEFAULT)

    // module carries the full type-specific extension list from §3.
    const moduleRules = schema.noteTypes.module
    expect(moduleRules).toBeDefined()
    for (const field of [
      'source_path',
      'language',
      'layer',
      'domain',
      'depends_on',
      'depended_by',
      'exports',
      'last_verified',
    ]) {
      expect(moduleRules.requiredFields).toContain(field)
    }

    // concept has no type-specific additions beyond the mandatory minimum.
    const conceptRules = schema.noteTypes.concept
    expect(conceptRules).toBeDefined()
    expect(Array.isArray(conceptRules.requiredFields)).toBe(true)

    // naming prefixes exist for both.
    expect(schema.naming.prefixByType.module).toBe('module-')
    expect(schema.naming.prefixByType.concept).toBe('concept-')

    // size limits exist for both.
    expect(schema.sizeLimits.module.minTokens).toBe(400)
    expect(schema.sizeLimits.module.maxTokens).toBe(800)
    expect(schema.sizeLimits.concept.minTokens).toBe(200)
    expect(schema.sizeLimits.concept.maxTokens).toBe(500)
  })

  test('tag taxonomy prefixes include the documented namespaces', () => {
    const schema = parseConventions(CONVENTIONS_MD_DEFAULT)
    for (const prefix of ['code/', 'pattern/', 'lang/', 'domain/', 'layer/']) {
      expect(schema.tagTaxonomy.prefixes).toContain(prefix)
    }
    expect(schema.tagTaxonomy.minCount).toBe(3)
    expect(schema.tagTaxonomy.maxCount).toBe(7)
  })
})

describe('parseConventions - error handling', () => {
  test('throws with a clear message when a required section is missing', () => {
    // Strip the "## Tag taxonomy" section entirely.
    const mutilated = CONVENTIONS_MD_DEFAULT.replace(
      /## Tag taxonomy[\s\S]*?(?=\n## )/,
      '',
    )
    expect(() => parseConventions(mutilated)).toThrow(/tag taxonomy/i)
  })

  test('throws with a clear parse error when schema version block is missing', () => {
    const mutilated = CONVENTIONS_MD_DEFAULT.replace(
      /## Schema version\n\n`[^`]+`/,
      '## Schema version\n\n',
    )
    expect(() => parseConventions(mutilated)).toThrow(/schema version/i)
  })

  test('throws with a clear message when a malformed YAML-ish code block is present in frontmatter schema', () => {
    // Replace the frontmatter-schema bullet list with a malformed YAML code
    // block so the parser's validation surfaces a typed error.
    const mutilated = CONVENTIONS_MD_DEFAULT.replace(
      /## Frontmatter schema[\s\S]*?(?=\n## Tag taxonomy)/,
      '## Frontmatter schema\n\n```yaml\n: : : not valid yaml\n  - [unbalanced\n```\n\n',
    )
    expect(() => parseConventions(mutilated)).toThrow()
  })
})
