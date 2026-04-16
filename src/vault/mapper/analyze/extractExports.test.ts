import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createTsParser } from './tsParser.js'
import { extractExports } from './extractExports.js'

const FIXTURES = path.resolve(import.meta.dir, '../../../../test/fixtures/mapper/exports')

function listTsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.[tj]sx?$/.test(f))
    .map((f) => path.join(dir, f))
    .sort()
}

describe('extractExports', () => {
  test('barrel-only: returns exact list from index.ts re-exports', () => {
    const dir = path.join(FIXTURES, 'barrel-only')
    const parser = createTsParser(dir)
    const files = listTsFiles(dir)
    const result = extractExports(parser, files)

    expect(result.errors).toHaveLength(0)
    // index.ts re-exports: foo, bar, baz, MyClass
    expect(result.exports).toEqual(['MyClass', 'bar', 'baz', 'foo'])
  })

  test('multi-file (no barrel): returns union of top-level exports, deduped, sorted', () => {
    const dir = path.join(FIXTURES, 'multi-file')
    const parser = createTsParser(dir)
    const files = listTsFiles(dir)
    const result = extractExports(parser, files)

    expect(result.errors).toHaveLength(0)
    expect(result.exports).toContain('alpha')
    expect(result.exports).toContain('ALPHA_CONST')
    expect(result.exports).toContain('BetaClass')
    expect(result.exports).toContain('default')
    // Sorted
    expect(result.exports).toEqual([...result.exports].sort())
  })

  test('no-exports: returns empty list', () => {
    const dir = path.join(FIXTURES, 'no-exports')
    const parser = createTsParser(dir)
    const files = listTsFiles(dir)
    const result = extractExports(parser, files)

    expect(result.exports).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  test('syntax-error: missing file skipped, good file contributes exports, error recorded', () => {
    const dir = path.join(FIXTURES, 'syntax-error')
    const parser = createTsParser(dir)
    const goodFiles = listTsFiles(dir).filter((f) => f.includes('good'))
    // Include a non-existent file to trigger a parse error
    const files = [...goodFiles, path.join(dir, 'nonexistent.ts')]
    const result = extractExports(parser, files)

    // good.ts exports goodFunction
    expect(result.exports).toContain('goodFunction')
    // nonexistent.ts should produce an error
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors.some((e) => e.file.includes('nonexistent.ts'))).toBe(true)
  })

  test('export cap: 25-symbol fixture returns 20 + sentinel', () => {
    const dir = path.join(FIXTURES, 'many-exports')
    const parser = createTsParser(dir)
    const files = listTsFiles(dir)
    const result = extractExports(parser, files)

    expect(result.exports).toHaveLength(21) // 20 + sentinel
    expect(result.exports[20]).toBe('\u2026+5 more')
    // First 20 should be sorted
    const first20 = result.exports.slice(0, 20)
    expect(first20).toEqual([...first20].sort())
  })

  test('default exports listed as "default"', () => {
    const dir = path.join(FIXTURES, 'multi-file')
    const parser = createTsParser(dir)
    const files = listTsFiles(dir)
    const result = extractExports(parser, files)

    // b.ts has `export default function betaDefault()`
    expect(result.exports).toContain('default')
    // Should NOT contain betaDefault as its own entry (it's the default)
    expect(result.exports).not.toContain('betaDefault')
  })

  test('empty file list returns empty exports', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-exports-'))
    try {
      const parser = createTsParser(tmp)
      const result = extractExports(parser, [])
      expect(result.exports).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
