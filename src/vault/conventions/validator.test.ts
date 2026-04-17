/**
 * Tests for the vault conventions validator.
 * See .specs/features/vault-bootstrap/tasks.md T4 and design.md (validator).
 *
 * Strategy: build a canonical-valid NoteDraft against the parsed default
 * schema, then mutate one field per test to assert each rule fires with the
 * expected `rule` id. A final test verifies non-short-circuiting reporting.
 */

import { describe, test, expect } from 'bun:test'
import { parseConventions } from './parser.js'
import { CONVENTIONS_MD_DEFAULT } from './defaults.js'
import { validateNote, type NoteDraft } from './validator.js'

const schema = parseConventions(CONVENTIONS_MD_DEFAULT)

/** A concept note is the simplest shape — no type-specific requiredFields. */
function validConceptDraft(): NoteDraft {
  return {
    filename: 'concept-binary-trees',
    folder: 'concepts',
    frontmatter: {
      title: 'Binary Trees',
      type: 'concept',
      tags: ['code/architecture', 'lang/typescript', 'domain/search'],
      status: 'draft',
      created: '2026-04-15',
      updated: '2026-04-15',
      confidence: 'medium',
      summary: 'A recursive hierarchical data structure.',
    },
    body: '# Binary Trees\n\n> **TL;DR**: hierarchy.\n',
  }
}

/** A module note exercises type-specific requiredFields. */
function validModuleDraft(): NoteDraft {
  return {
    filename: 'module-auth-service',
    folder: 'modules',
    frontmatter: {
      title: 'Auth Service',
      type: 'module',
      tags: ['code/architecture', 'lang/typescript', 'domain/auth'],
      status: 'active',
      created: '2026-04-15',
      updated: '2026-04-15',
      confidence: 'high',
      summary: 'Handles sign-in and token rotation.',
      source_path: 'src/auth',
      language: 'typescript',
      layer: 'backend',
      domain: 'auth',
      depends_on: [],
      depended_by: [],
      exports: [],
      last_verified: '2026-04-15',
    },
    body: '# Auth Service\n',
  }
}

describe('validateNote - happy path', () => {
  test('a fully-valid concept draft returns ok:true with no violations', () => {
    const result = validateNote(schema, validConceptDraft())
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  test('a fully-valid module draft returns ok:true with no violations', () => {
    const result = validateNote(schema, validModuleDraft())
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })
})

describe('validateNote - individual rule violations', () => {
  test('missing required field fires `required-field-missing`', () => {
    const draft = validConceptDraft()
    delete draft.frontmatter.summary
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(
      result.violations.some(
        (v) => v.rule === 'required-field-missing' && v.field === 'summary',
      ),
    ).toBe(true)
  })

  test('invalid `type` fires `type-enum`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.type = 'not-a-type'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'type-enum')).toBe(true)
  })

  test('invalid `status` fires `status-enum`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.status = 'wip'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'status-enum')).toBe(true)
  })

  test('invalid `confidence` fires `confidence-enum`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.confidence = 'certain'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'confidence-enum')).toBe(
      true,
    )
  })

  test('too-few tags (<3) fires `tag-count`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.tags = ['code/architecture', 'lang/typescript']
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'tag-count')).toBe(true)
  })

  test('too-many tags (>7) fires `tag-count`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.tags = [
      'code/architecture',
      'code/testing',
      'code/security',
      'code/performance',
      'lang/typescript',
      'lang/python',
      'domain/auth',
      'domain/search',
    ]
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'tag-count')).toBe(true)
  })

  test('tag with unknown prefix fires `tag-taxonomy`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.tags = [
      'code/architecture',
      'bogus/whatever',
      'domain/search',
    ]
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'tag-taxonomy')).toBe(true)
  })

  test('non-kebab-case tag fires `tag-kebab-case`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.tags = [
      'code/Architecture_Bad',
      'lang/typescript',
      'domain/search',
    ]
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'tag-kebab-case')).toBe(
      true,
    )
  })

  test('module without type-specific `source_path` fires `type-required-fields`', () => {
    const draft = validModuleDraft()
    delete draft.frontmatter.source_path
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(
      result.violations.some(
        (v) =>
          v.rule === 'type-required-fields' && v.field === 'source_path',
      ),
    ).toBe(true)
  })

  test('non-kebab-case filename fires `filename-casing`', () => {
    const draft = validConceptDraft()
    draft.filename = 'Concept_NotKebab'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'filename-casing')).toBe(
      true,
    )
  })

  test('decision filename without `adr-` prefix fires `filename-prefix`', () => {
    const draft = validConceptDraft()
    // Turn the concept into a decision but keep a non-prefixed filename.
    draft.frontmatter.type = 'decision'
    draft.filename = 'foo-some-decision'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'filename-prefix')).toBe(
      true,
    )
  })
})

describe('validateNote - aggregate reporting', () => {
  test('multiple violations are reported together (no short-circuit)', () => {
    const draft = validConceptDraft()
    draft.frontmatter.status = 'wip' // status-enum
    draft.frontmatter.confidence = 'certain' // confidence-enum
    draft.frontmatter.tags = ['bogus/one'] // tag-count AND tag-taxonomy
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    const rules = new Set(result.violations.map((v) => v.rule))
    expect(rules.has('status-enum')).toBe(true)
    expect(rules.has('confidence-enum')).toBe(true)
    expect(rules.has('tag-count')).toBe(true)
    expect(rules.has('tag-taxonomy')).toBe(true)
  })
})

describe('validateNote - scope rules (PIFA-05)', () => {
  test('absent `scope` is not a violation (default applied at write time)', () => {
    const draft = validConceptDraft()
    delete draft.frontmatter.scope
    const result = validateNote(schema, draft)
    expect(result.violations.find((v) => v.field === 'scope')).toBeUndefined()
  })

  test('explicit `scope: project` on a concept passes', () => {
    const draft = validConceptDraft()
    draft.frontmatter.scope = 'project'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(true)
  })

  test('explicit `scope: global` on a non-module type passes', () => {
    const draft = validConceptDraft()
    draft.frontmatter.scope = 'global'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(true)
  })

  test('garbage `scope` value fires `invalid-value`', () => {
    const draft = validConceptDraft()
    draft.frontmatter.scope = 'globl'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    const v = result.violations.find((x) => x.field === 'scope')
    expect(v?.rule).toBe('invalid-value')
    expect(v?.got).toBe('globl')
  })

  test('`type: module` + `scope: global` fires `type-scope-mismatch`', () => {
    const draft = validModuleDraft()
    draft.frontmatter.scope = 'global'
    const result = validateNote(schema, draft)
    expect(result.ok).toBe(false)
    const v = result.violations.find((x) => x.field === 'scope')
    expect(v?.rule).toBe('type-scope-mismatch')
    expect(v?.got).toBe('global')
  })

  test('`type: module` + `scope: project` (or absent) passes scope check', () => {
    const explicit = validModuleDraft()
    explicit.frontmatter.scope = 'project'
    expect(validateNote(schema, explicit).ok).toBe(true)

    const implicit = validModuleDraft()
    delete implicit.frontmatter.scope
    expect(validateNote(schema, implicit).ok).toBe(true)
  })
})
