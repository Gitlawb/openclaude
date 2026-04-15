/**
 * Tests for canonical YAML frontmatter serializer.
 * See .specs/features/vault-bootstrap/tasks.md T2.
 */

import { describe, test, expect } from 'bun:test'
import {
  FRONTMATTER_FIELD_ORDER,
  serializeFrontmatter,
} from './yamlFrontmatter.js'
import { parseFrontmatter } from './frontmatterParser.js'

describe('FRONTMATTER_FIELD_ORDER', () => {
  test('starts with the mandatory minimum schema fields from VAULT-SCHEMA §3', () => {
    // First 10 entries should match the mandatory minimum schema order.
    expect(FRONTMATTER_FIELD_ORDER.slice(0, 10)).toEqual([
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
    ])
  })

  test('includes type-specific module/decision/flow/incident fields', () => {
    // Spot-check that canonical order contains the key extension fields.
    for (const field of [
      'source_path',
      'language',
      'layer',
      'domain',
      'depends_on',
      'depended_by',
      'exports',
      'last_verified',
      'decision_makers',
      'supersedes',
      'superseded_by',
      'trigger',
      'participants',
      'severity',
      'date_occurred',
      'date_resolved',
      'duration_minutes',
      'root_cause',
      'affected_modules',
      'source',
    ]) {
      expect(FRONTMATTER_FIELD_ORDER).toContain(field)
    }
  })
})

describe('serializeFrontmatter', () => {
  test('emits scalar fields in canonical order regardless of input order', () => {
    const out = serializeFrontmatter({
      status: 'stable',
      title: 'API Rate Limiting Patterns',
      type: 'concept',
    })

    // Must begin and end with --- fences
    expect(out.startsWith('---\n')).toBe(true)
    expect(out.endsWith('---\n')).toBe(true)

    const titleIdx = out.indexOf('title:')
    const typeIdx = out.indexOf('type:')
    const statusIdx = out.indexOf('status:')

    expect(titleIdx).toBeGreaterThan(-1)
    expect(typeIdx).toBeGreaterThan(titleIdx)
    expect(statusIdx).toBeGreaterThan(typeIdx)
  })

  test('unknown fields are appended after canonical fields, sorted alphabetically', () => {
    const out = serializeFrontmatter({
      zeta_custom: 'z',
      alpha_custom: 'a',
      title: 'T',
      middle_custom: 'm',
    })

    const titleIdx = out.indexOf('title:')
    const alphaIdx = out.indexOf('alpha_custom:')
    const middleIdx = out.indexOf('middle_custom:')
    const zetaIdx = out.indexOf('zeta_custom:')

    // All unknowns come after title (a canonical field).
    expect(alphaIdx).toBeGreaterThan(titleIdx)
    // And they are alphabetical among themselves.
    expect(alphaIdx).toBeLessThan(middleIdx)
    expect(middleIdx).toBeLessThan(zetaIdx)
  })

  test('emits tags as a YAML array and related as an array of WikiLink strings', () => {
    const out = serializeFrontmatter({
      title: 'AuthService',
      type: 'module',
      tags: ['code/api-design', 'pattern/rate-limiting'],
      related: ['[[foo]]', '[[bar]]'],
    })

    // Tags as block-list items
    expect(out).toContain('tags:')
    expect(out).toContain('- code/api-design')
    expect(out).toContain('- pattern/rate-limiting')

    // WikiLink entries must be quoted (brackets are YAML flow indicators).
    expect(out).toContain('related:')
    // Accept either "[[foo]]" or '[[foo]]' style — must be quoted.
    expect(out).toMatch(/- ["']\[\[foo\]\]["']/)
    expect(out).toMatch(/- ["']\[\[bar\]\]["']/)
  })

  test('round-trips with parseFrontmatter', () => {
    const input = {
      title: 'API Rate Limiting Patterns',
      type: 'concept',
      tags: ['code/api-design', 'pattern/rate-limiting', 'lang/typescript'],
      status: 'stable',
      confidence: 'high',
      summary: 'Token bucket and sliding window rate-limiting strategies.',
      related: ['[[api-gateway-architecture]]'],
    }

    const serialized = serializeFrontmatter(input)
    const { frontmatter } = parseFrontmatter(serialized)

    expect(frontmatter.title).toBe(input.title)
    expect(frontmatter.type).toBe(input.type)
    expect(frontmatter.tags).toEqual(input.tags)
    expect(frontmatter.status).toBe(input.status)
    expect(frontmatter.confidence).toBe(input.confidence)
    expect(frontmatter.summary).toBe(input.summary)
    expect(frontmatter.related).toEqual(input.related)
  })

  test('empty frontmatter produces a valid empty block', () => {
    const out = serializeFrontmatter({})
    expect(out.startsWith('---\n')).toBe(true)
    expect(out.endsWith('---\n')).toBe(true)
    // Empty block round-trips to an empty object.
    const { frontmatter, content } = parseFrontmatter(out)
    expect(frontmatter).toEqual({})
    expect(content).toBe('')
  })

  test('date-string fields are preserved without type coercion', () => {
    const out = serializeFrontmatter({
      title: 'Note',
      created: '2026-04-15',
      updated: '2026-04-15',
    })

    // Dates must survive round-trip as the same ISO string.
    const { frontmatter } = parseFrontmatter(out)
    expect(String(frontmatter.created)).toContain('2026-04-15')
    expect(String(frontmatter.updated)).toContain('2026-04-15')
  })

  test('emits numeric fields (e.g. duration_minutes) as numbers', () => {
    const out = serializeFrontmatter({
      title: 'Incident',
      type: 'incident',
      duration_minutes: 42,
    })

    // Numbers are not quoted in YAML.
    expect(out).toMatch(/duration_minutes:\s*42\b/)

    const { frontmatter } = parseFrontmatter(out)
    expect(frontmatter.duration_minutes).toBe(42)
  })
})
