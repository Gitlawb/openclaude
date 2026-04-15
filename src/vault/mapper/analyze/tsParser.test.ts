import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createTsParser } from './tsParser.js'

function makeRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-tsparser-'))
  return dir
}

function write(repo: string, rel: string, content: string) {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return abs
}

describe('createTsParser', () => {
  let repo: string

  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('is lazy — no Project built until first sourceFile() call', () => {
    // If Project were built eagerly, constructing the parser with a bogus
    // tsconfig would throw. It should not.
    write(repo, 'tsconfig.json', '{"compilerOptions":{"garbage":true}}')
    // Constructing must not throw — lazy.
    const parser = createTsParser(repo)
    expect(parser.repoRoot).toBe(path.resolve(repo))
  })

  test('sourceFile() returns ts-morph SourceFile for a valid TS file', () => {
    const file = write(repo, 'src/foo.ts', `export const x = 1\n`)
    const parser = createTsParser(repo)
    const sf = parser.sourceFile(file)
    expect(String(sf.getFilePath())).toBe(path.resolve(file))
    expect(sf.getText()).toContain('export const x = 1')
  })

  test('sourceFile() caches repeat lookups (same instance)', () => {
    const file = write(repo, 'src/foo.ts', `export const x = 1\n`)
    const parser = createTsParser(repo)
    const a = parser.sourceFile(file)
    const b = parser.sourceFile(file)
    expect(a).toBe(b)
  })

  test('resolveModuleSpecifier resolves a relative import to an absolute path', () => {
    const from = write(repo, 'src/a.ts', `import { y } from './b'\nexport const x = y`)
    write(repo, 'src/b.ts', `export const y = 2\n`)
    const parser = createTsParser(repo)
    const resolved = parser.resolveModuleSpecifier('./b', from)
    expect(resolved).toBe(path.resolve(repo, 'src/b.ts'))
  })

  test('resolveModuleSpecifier honors tsconfig.paths aliases', () => {
    write(
      repo,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          baseUrl: '.',
          paths: { '@app/*': ['src/*'] },
        },
      }),
    )
    const from = write(repo, 'src/a.ts', `import { y } from '@app/lib/b'\n`)
    write(repo, 'src/lib/b.ts', `export const y = 3\n`)
    const parser = createTsParser(repo)
    const resolved = parser.resolveModuleSpecifier('@app/lib/b', from)
    expect(resolved).toBe(path.resolve(repo, 'src/lib/b.ts'))
  })

  test('resolveModuleSpecifier returns null for external packages', () => {
    const from = write(repo, 'src/a.ts', `import fs from 'node:fs'\n`)
    const parser = createTsParser(repo)
    // node: builtins don't resolve to a file path in our repo.
    const resolved = parser.resolveModuleSpecifier('node:fs', from)
    expect(resolved).toBeNull()
  })

  test('resolveModuleSpecifier returns null for unresolvable specifiers', () => {
    const from = write(repo, 'src/a.ts', `\n`)
    const parser = createTsParser(repo)
    expect(parser.resolveModuleSpecifier('./does-not-exist', from)).toBeNull()
  })
})
