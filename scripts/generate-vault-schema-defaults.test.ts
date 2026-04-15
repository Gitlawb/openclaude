import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  extractBlocks,
  renderDefaultsFile,
  REPO_VAULT_SCHEMA_PATH,
  GENERATED_DEFAULTS_PATH,
} from './generate-vault-schema-defaults.ts'

const FIXTURE = `# Fake schema

<!-- SCHEMA-VERSION: 9.9.9 -->

<!-- CONVENTIONS-MD-BEGIN -->
# Conventions

## Frontmatter schema
- title

## Tag taxonomy
- code/
<!-- CONVENTIONS-MD-END -->

<!-- TEMPLATE-MODULE-BEGIN -->
module template body
<!-- TEMPLATE-MODULE-END -->

<!-- TEMPLATE-CONCEPT-BEGIN -->
concept template body
<!-- TEMPLATE-CONCEPT-END -->

<!-- TEMPLATE-FLOW-BEGIN -->
flow template body
<!-- TEMPLATE-FLOW-END -->

<!-- TEMPLATE-DECISION-BEGIN -->
decision template body
<!-- TEMPLATE-DECISION-END -->

<!-- TEMPLATE-INCIDENT-BEGIN -->
incident template body
<!-- TEMPLATE-INCIDENT-END -->

<!-- TEMPLATE-MOC-BEGIN -->
moc template body
<!-- TEMPLATE-MOC-END -->
`

describe('generate-vault-schema-defaults: extractor', () => {
  test('extracts schema version from marker', () => {
    const blocks = extractBlocks(FIXTURE)
    expect(blocks.schemaVersion).toBe('9.9.9')
  })

  test('extracts conventions body between CONVENTIONS-MD markers', () => {
    const blocks = extractBlocks(FIXTURE)
    expect(blocks.conventionsMd).toContain('# Conventions')
    expect(blocks.conventionsMd).toContain('## Frontmatter schema')
    expect(blocks.conventionsMd).toContain('## Tag taxonomy')
    expect(blocks.conventionsMd).not.toContain('CONVENTIONS-MD-BEGIN')
    expect(blocks.conventionsMd).not.toContain('CONVENTIONS-MD-END')
  })

  test('extracts every note-type template', () => {
    const blocks = extractBlocks(FIXTURE)
    const types = ['module', 'concept', 'flow', 'decision', 'incident', 'moc'] as const
    for (const t of types) {
      expect(blocks.templates[t]).toBeDefined()
      expect(blocks.templates[t]).toContain(`${t} template body`)
    }
  })

  test('throws if a required marker is missing', () => {
    const bad = FIXTURE.replace('<!-- TEMPLATE-MOC-BEGIN -->', '<!-- NOPE -->')
    expect(() => extractBlocks(bad)).toThrow(/moc/i)
  })
})

describe('generate-vault-schema-defaults: renderer', () => {
  test('rendered file contains required exports and auto-gen header', () => {
    const blocks = extractBlocks(FIXTURE)
    const out = renderDefaultsFile(blocks)
    expect(out).toMatch(/AUTO-GENERATED/)
    expect(out).toContain('export const SCHEMA_VERSION')
    expect(out).toContain('9.9.9')
    expect(out).toContain('export const CONVENTIONS_MD_DEFAULT')
    expect(out).toContain('export const TEMPLATES')
    expect(out).toContain("export type NoteType")
    expect(out).toContain("export type NoteStatus")
    expect(out).toContain("export type Confidence")
    expect(out).toContain('export interface ConventionSchema')
  })

  test('render output is deterministic (same input → same output)', () => {
    const blocks = extractBlocks(FIXTURE)
    const a = renderDefaultsFile(blocks)
    const b = renderDefaultsFile(blocks)
    expect(a).toBe(b)
  })
})

describe('generate-vault-schema-defaults: drift detector', () => {
  test('checked-in defaults.ts is in sync with VAULT-SCHEMA.md', () => {
    expect(existsSync(REPO_VAULT_SCHEMA_PATH)).toBe(true)
    const source = readFileSync(REPO_VAULT_SCHEMA_PATH, 'utf8')
    const blocks = extractBlocks(source)
    const expected = renderDefaultsFile(blocks)

    expect(existsSync(GENERATED_DEFAULTS_PATH)).toBe(true)
    const actual = readFileSync(GENERATED_DEFAULTS_PATH, 'utf8')
    expect(actual).toBe(expected)
  })

  test('CONVENTIONS_MD_DEFAULT contains canonical section headers', () => {
    const source = readFileSync(REPO_VAULT_SCHEMA_PATH, 'utf8')
    const blocks = extractBlocks(source)
    expect(blocks.conventionsMd).toMatch(/##\s+Frontmatter schema/)
    expect(blocks.conventionsMd).toMatch(/##\s+Tag taxonomy/)
    expect(blocks.conventionsMd).toMatch(/##\s+Naming/)
    expect(blocks.conventionsMd).toMatch(/##\s+Size limits/)
  })

  test('TEMPLATES covers every NoteType', () => {
    const source = readFileSync(REPO_VAULT_SCHEMA_PATH, 'utf8')
    const blocks = extractBlocks(source)
    const expected = ['module', 'concept', 'flow', 'decision', 'incident', 'moc']
    for (const t of expected) {
      expect(blocks.templates[t as keyof typeof blocks.templates]).toBeTruthy()
    }
  })
})
