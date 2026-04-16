import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { toModuleNoteDraft } from './moduleNote.js'
import { loadConventions } from '../../writeNote.js'
import { validateNote } from '../../conventions/validator.js'
import type { ModuleDescriptor } from '../types.js'

function makeDescriptor(overrides: Partial<ModuleDescriptor> = {}): ModuleDescriptor {
  return {
    slug: 'auth-middleware',
    sourcePath: '/repo/src/auth',
    files: [],
    language: 'typescript',
    exports: ['authenticate', 'authorize', 'default'],
    dependsOn: ['utils-http', 'config'],
    dependedBy: ['api-routes'],
    externals: ['jsonwebtoken', 'express'],
    summary: 'JWT-based authentication and authorization middleware.',
    responsibilities: [
      'Validates JWT tokens from Authorization header',
      'Enforces role-based access control',
      'Attaches user context to request object',
    ],
    domain: 'auth',
    layer: 'service',
    fallback: false,
    ...overrides,
  }
}

describe('toModuleNoteDraft', () => {
  test('produces a draft with correct filename and folder', () => {
    const draft = toModuleNoteDraft(makeDescriptor())
    expect(draft.filename).toBe('module-auth-middleware')
    expect(draft.folder).toBe('knowledge')
  })

  test('frontmatter includes all required fields', () => {
    const draft = toModuleNoteDraft(makeDescriptor())
    const fm = draft.frontmatter

    expect(fm.title).toBe('auth-middleware')
    expect(fm.type).toBe('module')
    expect(fm.source_path).toBe('/repo/src/auth')
    expect(fm.language).toBe('typescript')
    expect(fm.layer).toBe('service')
    expect(fm.domain).toBe('auth')
    expect(fm.status).toBe('draft')
    expect(fm.confidence).toBe('medium')
    expect(fm.summary).toBe('JWT-based authentication and authorization middleware.')
    expect(fm.created).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(fm.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(fm.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('depends_on and depended_by are WikiLink strings', () => {
    const draft = toModuleNoteDraft(makeDescriptor())
    const fm = draft.frontmatter

    expect(fm.depends_on).toEqual(['[[module-utils-http]]', '[[module-config]]'])
    expect(fm.depended_by).toEqual(['[[module-api-routes]]'])
  })

  test('tags include code/module, lang/*, layer/*, domain/*', () => {
    const draft = toModuleNoteDraft(makeDescriptor())
    const tags = draft.frontmatter.tags as string[]

    expect(tags).toContain('code/module')
    expect(tags).toContain('lang/typescript')
    expect(tags).toContain('layer/service')
    expect(tags).toContain('domain/auth')
    expect(tags.length).toBeGreaterThanOrEqual(3)
    expect(tags.length).toBeLessThanOrEqual(7)
  })

  test('confidence maps: fallback→low, LLM ok→medium', () => {
    const ok = toModuleNoteDraft(makeDescriptor({ fallback: false }))
    expect(ok.frontmatter.confidence).toBe('medium')

    const fb = toModuleNoteDraft(makeDescriptor({ fallback: true }))
    expect(fb.frontmatter.confidence).toBe('low')
  })

  test('body contains all 6 template sections in order', () => {
    const draft = toModuleNoteDraft(makeDescriptor())

    expect(draft.body).toContain('**TL;DR**')
    expect(draft.body).toContain('## Public API')
    expect(draft.body).toContain('## Internal design')
    expect(draft.body).toContain('## Dependencies')
    expect(draft.body).toContain('## Configuration')
    expect(draft.body).toContain('## Error handling')

    // Verify ordering
    const tldr = draft.body.indexOf('**TL;DR**')
    const api = draft.body.indexOf('## Public API')
    const design = draft.body.indexOf('## Internal design')
    const deps = draft.body.indexOf('## Dependencies')
    const config = draft.body.indexOf('## Configuration')
    const errors = draft.body.indexOf('## Error handling')
    expect(tldr).toBeLessThan(api)
    expect(api).toBeLessThan(design)
    expect(design).toBeLessThan(deps)
    expect(deps).toBeLessThan(config)
    expect(config).toBeLessThan(errors)
  })

  test('exports listed as inline code in Public API', () => {
    const draft = toModuleNoteDraft(makeDescriptor())
    expect(draft.body).toContain('- `authenticate`')
    expect(draft.body).toContain('- `authorize`')
    expect(draft.body).toContain('- `default`')
  })

  test('dependencies section shows internal WikiLinks and external packages', () => {
    const draft = toModuleNoteDraft(makeDescriptor())
    expect(draft.body).toContain('[[module-utils-http]]')
    expect(draft.body).toContain('[[module-config]]')
    expect(draft.body).toContain('`jsonwebtoken`')
    expect(draft.body).toContain('`express`')
  })

  test('envScan detects process.env references in files', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-moddraft-'))
    try {
      const file = path.join(tmp, 'config.ts')
      writeFileSync(file, `export const secret = process.env.JWT_SECRET\n`, 'utf-8')

      const draft = toModuleNoteDraft(makeDescriptor({ files: [file] }))
      expect(draft.body).toContain('`JWT_SECRET`')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('draft passes convention validator', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-validate-'))
    try {
      const schema = loadConventions(tmp)
      const draft = toModuleNoteDraft(makeDescriptor())
      const result = validateNote(schema, draft)
      expect(result.ok).toBe(true)
      expect(result.violations).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('empty exports produces "No public exports detected"', () => {
    const draft = toModuleNoteDraft(makeDescriptor({ exports: [] }))
    expect(draft.body).toContain('No public exports detected')
  })

  test('no dependencies produces "None detected"', () => {
    const draft = toModuleNoteDraft(
      makeDescriptor({ dependsOn: [], dependedBy: [], externals: [] }),
    )
    const depsSection = draft.body.slice(
      draft.body.indexOf('## Dependencies'),
      draft.body.indexOf('## Configuration'),
    )
    expect(depsSection).toContain('None detected')
  })
})
