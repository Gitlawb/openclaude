import { describe, test, expect } from 'bun:test'
import path from 'node:path'
import { createTsParser } from './tsParser.js'
import { extractImports } from './extractImports.js'

const FIXTURES = path.resolve(import.meta.dir, '../../../../test/fixtures/mapper/imports')

describe('extractImports', () => {
  test('relative import resolves to absolute path', () => {
    const dir = path.join(FIXTURES, 'relative')
    const parser = createTsParser(dir)
    const files = [path.join(dir, 'a.ts')]
    const result = extractImports(parser, files)

    expect(result.errors).toHaveLength(0)
    expect(result.imports.length).toBeGreaterThanOrEqual(1)

    const rel = result.imports.find((i) => i.specifier === './b.js')
    expect(rel).toBeDefined()
    expect(rel!.resolvedPath).toBe(path.join(dir, 'b.ts'))
    expect(rel!.isExternal).toBe(false)
    expect(rel!.isTypeOnly).toBe(false)
  })

  test('external imports: node:fs and zod resolve as external with null path', () => {
    const dir = path.join(FIXTURES, 'external')
    const parser = createTsParser(dir)
    const files = [path.join(dir, 'a.ts')]
    const result = extractImports(parser, files)

    const nodeFs = result.imports.find((i) => i.specifier === 'node:fs')
    expect(nodeFs).toBeDefined()
    expect(nodeFs!.resolvedPath).toBeNull()
    expect(nodeFs!.isExternal).toBe(true)

    const zod = result.imports.find((i) => i.specifier === 'zod')
    expect(zod).toBeDefined()
    expect(zod!.resolvedPath).toBeNull()
    expect(zod!.isExternal).toBe(true)
  })

  test('import type is flagged as isTypeOnly: true', () => {
    const dir = path.join(FIXTURES, 'type-only')
    const parser = createTsParser(dir)
    const files = [path.join(dir, 'a.ts')]
    const result = extractImports(parser, files)

    expect(result.imports.length).toBeGreaterThanOrEqual(1)
    const typeImport = result.imports.find((i) => i.specifier === './b.js')
    expect(typeImport).toBeDefined()
    expect(typeImport!.isTypeOnly).toBe(true)
    expect(typeImport!.resolvedPath).toBe(path.join(dir, 'b.ts'))
  })

  test('dynamic import with literal string resolves correctly', () => {
    const dir = path.join(FIXTURES, 'dynamic-literal')
    const parser = createTsParser(dir)
    const files = [path.join(dir, 'a.ts')]
    const result = extractImports(parser, files)

    const dynImport = result.imports.find((i) => i.specifier === './b.js')
    expect(dynImport).toBeDefined()
    expect(dynImport!.resolvedPath).toBe(path.join(dir, 'b.ts'))
    expect(dynImport!.isExternal).toBe(false)
    expect(result.skipped).toHaveLength(0)
  })

  test('dynamic import with non-literal produces skip entry and <dynamic> ref', () => {
    const dir = path.join(FIXTURES, 'dynamic-nonliteral')
    const parser = createTsParser(dir)
    const files = [path.join(dir, 'a.ts')]
    const result = extractImports(parser, files)

    const dynRef = result.imports.find((i) => i.specifier === '<dynamic>')
    expect(dynRef).toBeDefined()
    expect(dynRef!.resolvedPath).toBeNull()

    expect(result.skipped.length).toBeGreaterThanOrEqual(1)
    expect(result.skipped[0].reason).toContain('dynamic-import-skipped')
  })

  test('tsconfig.paths alias resolves via facade', () => {
    const dir = path.join(FIXTURES, 'alias')
    const parser = createTsParser(dir, { tsConfigFilePath: path.join(dir, 'tsconfig.json') })
    const files = [path.join(dir, 'main.ts')]
    const result = extractImports(parser, files)

    const aliased = result.imports.find((i) => i.specifier === '@lib/utils.js')
    expect(aliased).toBeDefined()
    expect(aliased!.resolvedPath).toBe(path.join(dir, 'lib', 'utils.ts'))
    expect(aliased!.isExternal).toBe(false)
  })

  test('duplicate imports from same file are deduped per (specifier, fromFile)', () => {
    // Create a temp parser with an inline source that imports the same thing twice
    const dir = path.join(FIXTURES, 'relative')
    const parser = createTsParser(dir)
    // a.ts imports ./b.js once — feeding it twice should still yield one entry
    const files = [path.join(dir, 'a.ts'), path.join(dir, 'a.ts')]
    const result = extractImports(parser, files)

    const bImports = result.imports.filter((i) => i.specifier === './b.js')
    expect(bImports).toHaveLength(1)
  })

  test('non-existent file produces error, other files still analyzed', () => {
    const dir = path.join(FIXTURES, 'relative')
    const parser = createTsParser(dir)
    const files = [path.join(dir, 'nonexistent.ts'), path.join(dir, 'a.ts')]
    const result = extractImports(parser, files)

    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors[0].file).toContain('nonexistent.ts')
    // a.ts should still have been analyzed
    expect(result.imports.some((i) => i.specifier === './b.js')).toBe(true)
  })
})
