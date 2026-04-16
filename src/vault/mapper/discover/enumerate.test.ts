import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { enumerateModules } from './enumerate.js'

function makeRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'bridgeai-enumerate-'))
}

function write(repo: string, rel: string, content: string = '') {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

describe('enumerateModules', () => {
  let repo: string

  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('returns one candidate per folder with TS/JS files', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/foo/index.ts', 'export const x = 1')
    write(repo, 'src/bar/main.ts', 'export const y = 2')

    const candidates = enumerateModules(src, repo)
    expect(candidates).toHaveLength(2)
    expect(candidates.map(c => c.slug)).toEqual(['bar', 'foo'])
  })

  test('skips folders with only non-source files', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/good/index.ts', 'export const x = 1')
    write(repo, 'src/assets/logo.png', 'binary')
    write(repo, 'src/docs/readme.md', '# hi')
    write(repo, 'src/config/settings.json', '{}')

    const candidates = enumerateModules(src, repo)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].slug).toBe('good')
  })

  test('skips node_modules and .git', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/app/index.ts', 'export const x = 1')
    write(repo, 'src/node_modules/pkg/index.ts', 'bad')
    write(repo, 'src/.git/hooks/pre-commit.js', 'bad')

    const candidates = enumerateModules(src, repo)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].slug).toBe('app')
  })

  test('slugs are kebab-case for nested paths', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/vault/mapper/analyze/parser.ts', '')

    const candidates = enumerateModules(src, repo)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].slug).toBe('vault-mapper-analyze')
  })

  test('language is typescript when any .ts/.tsx present', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/mixed/helper.js', '')
    write(repo, 'src/mixed/main.ts', '')

    const candidates = enumerateModules(src, repo)
    expect(candidates[0].language).toBe('typescript')
  })

  test('language is javascript when only .js/.jsx/.mjs present', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/legacy/app.js', '')
    write(repo, 'src/legacy/utils.mjs', '')

    const candidates = enumerateModules(src, repo)
    expect(candidates[0].language).toBe('javascript')
  })

  test('files list contains absolute paths sorted', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/mod/b.ts', '')
    write(repo, 'src/mod/a.ts', '')

    const candidates = enumerateModules(src, repo)
    expect(candidates[0].files).toEqual([
      path.join(repo, 'src/mod/a.ts'),
      path.join(repo, 'src/mod/b.ts'),
    ])
  })

  test('output is sorted by slug for determinism', () => {
    const src = path.join(repo, 'src')
    write(repo, 'src/zebra/z.ts', '')
    write(repo, 'src/alpha/a.ts', '')
    write(repo, 'src/middle/m.ts', '')

    const candidates = enumerateModules(src, repo)
    expect(candidates.map(c => c.slug)).toEqual(['alpha', 'middle', 'zebra'])
  })
})
