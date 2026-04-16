import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildSemanticPrompt, type PromptInput } from './promptBuilder.js'

function makeRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'bridgeai-prompt-'))
}

function write(repo: string, rel: string, content: string) {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return abs
}

describe('buildSemanticPrompt', () => {
  let repo: string

  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  function makeInput(overrides: Partial<PromptInput> = {}): PromptInput {
    const srcDir = path.join(repo, 'src/mod')
    const files = [
      write(repo, 'src/mod/index.ts', 'export const main = () => {}'),
      write(repo, 'src/mod/helper.ts', 'export function help() { return 42 }'),
    ]
    return {
      slug: 'mod',
      sourcePath: srcDir,
      files,
      repoRoot: repo,
      exports: ['main', 'help'],
      imports: [],
      ...overrides,
    }
  }

  test('returns systemPrompt, userPrompt, and schema', () => {
    const result = buildSemanticPrompt(makeInput())
    expect(result.systemPrompt).toContain('code analyst')
    expect(result.userPrompt).toContain('Module: mod')
    expect(result.schema).toBeDefined()
    expect(result.schema.required).toContain('summary')
  })

  test('userPrompt includes file listing', () => {
    const result = buildSemanticPrompt(makeInput())
    expect(result.userPrompt).toContain('src/mod/index.ts')
    expect(result.userPrompt).toContain('src/mod/helper.ts')
  })

  test('userPrompt includes exports', () => {
    const result = buildSemanticPrompt(makeInput())
    expect(result.userPrompt).toContain('Exports: main, help')
  })

  test('userPrompt includes file snippets', () => {
    const result = buildSemanticPrompt(makeInput())
    expect(result.userPrompt).toContain('export const main')
  })

  test('userPrompt includes internal and external imports', () => {
    const result = buildSemanticPrompt(makeInput({
      imports: [
        { specifier: './helper', resolvedPath: '/resolved/helper.ts', isTypeOnly: false },
        { specifier: 'zod', resolvedPath: null, isTypeOnly: false },
      ],
    }))
    expect(result.userPrompt).toContain('Internal imports: ./helper')
    expect(result.userPrompt).toContain('External imports: zod')
  })

  test('userPrompt includes README snippet when provided', () => {
    const result = buildSemanticPrompt(makeInput({
      readmeSnippet: 'This module handles data processing.',
    }))
    expect(result.userPrompt).toContain('README excerpt')
    expect(result.userPrompt).toContain('data processing')
  })

  test('systemPrompt lists all valid layer values', () => {
    const result = buildSemanticPrompt(makeInput())
    expect(result.systemPrompt).toContain('"cli"')
    expect(result.systemPrompt).toContain('"service"')
    expect(result.systemPrompt).toContain('"unknown"')
  })

  test('handles empty exports gracefully', () => {
    const result = buildSemanticPrompt(makeInput({ exports: [] }))
    expect(result.userPrompt).toContain('Exports: (none detected)')
  })

  test('large file list is truncated', () => {
    const files: string[] = []
    for (let i = 0; i < 40; i++) {
      files.push(write(repo, `src/mod/file${i}.ts`, `export const x${i} = ${i}`))
    }
    const result = buildSemanticPrompt(makeInput({ files }))
    expect(result.userPrompt).toContain('…+')
    expect(result.userPrompt).toContain('more')
  })

  test('type-only imports are excluded from internal imports section', () => {
    const result = buildSemanticPrompt(makeInput({
      imports: [
        { specifier: './types', resolvedPath: '/resolved/types.ts', isTypeOnly: true },
        { specifier: './helper', resolvedPath: '/resolved/helper.ts', isTypeOnly: false },
      ],
    }))
    expect(result.userPrompt).toContain('Internal imports: ./helper')
    expect(result.userPrompt).not.toContain('Internal imports: ./types')
  })
})
