import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveSourceRoot } from './sourceRoot.js'
import type { IndexResult } from '../../types.js'

function makeRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'bridgeai-sourceroot-'))
}

function write(repo: string, rel: string, content: string) {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

function mkdir(repo: string, rel: string) {
  mkdirSync(path.join(repo, rel), { recursive: true })
}

function baseIndex(overrides: Partial<IndexResult> = {}): IndexResult {
  return {
    git: null,
    languages: ['TypeScript'],
    primaryLanguage: 'TypeScript',
    manifests: [],
    structure: { isMonorepo: false, topLevelDirs: [], entryPoints: [] },
    testing: { testDirs: [], testCommands: [] },
    docs: { hasReadme: false, hasDocsDir: false, hasExistingClaudeMd: false },
    commands: {},
    fileCount: 10,
    isLargeRepo: false,
    ...overrides,
  }
}

describe('resolveSourceRoot', () => {
  let repo: string

  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('tsconfig.json include wins over src/', () => {
    mkdir(repo, 'src')
    mkdir(repo, 'source')
    write(repo, 'tsconfig.json', JSON.stringify({
      include: ['source/**/*'],
    }))
    const roots = resolveSourceRoot(repo, baseIndex())
    expect(roots).toEqual([path.join(repo, 'source')])
  })

  test('tsconfig.json compilerOptions.rootDir wins over include', () => {
    mkdir(repo, 'src')
    mkdir(repo, 'custom')
    write(repo, 'tsconfig.json', JSON.stringify({
      compilerOptions: { rootDir: './custom' },
      include: ['src/**/*'],
    }))
    const roots = resolveSourceRoot(repo, baseIndex())
    expect(roots).toEqual([path.join(repo, 'custom')])
  })

  test('falls back to src/ when no tsconfig', () => {
    mkdir(repo, 'src')
    const roots = resolveSourceRoot(repo, baseIndex())
    expect(roots).toEqual([path.join(repo, 'src')])
  })

  test('falls back to lib/ when no tsconfig and no src/', () => {
    mkdir(repo, 'lib')
    const roots = resolveSourceRoot(repo, baseIndex())
    expect(roots).toEqual([path.join(repo, 'lib')])
  })

  test('falls back to repo root when nothing else matches', () => {
    const roots = resolveSourceRoot(repo, baseIndex())
    expect(roots).toEqual([path.resolve(repo)])
  })

  test('tsconfig rootDir that does not exist on disk falls through', () => {
    mkdir(repo, 'src')
    write(repo, 'tsconfig.json', JSON.stringify({
      compilerOptions: { rootDir: './nonexistent' },
    }))
    const roots = resolveSourceRoot(repo, baseIndex())
    expect(roots).toEqual([path.join(repo, 'src')])
  })

  test('monorepo with workspaces returns one root per workspace', () => {
    mkdir(repo, 'packages/app-a/src')
    mkdir(repo, 'packages/app-b/lib')
    write(repo, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }))

    const idx = baseIndex({
      structure: {
        isMonorepo: true,
        topLevelDirs: ['packages'],
        entryPoints: [],
        workspaces: ['packages/*'],
      },
    })
    const roots = resolveSourceRoot(repo, idx)
    expect(roots).toHaveLength(2)
    expect(roots).toContain(path.join(repo, 'packages/app-a/src'))
    expect(roots).toContain(path.join(repo, 'packages/app-b/lib'))
  })

  test('monorepo with exact workspace path', () => {
    mkdir(repo, 'apps/web/src')
    write(repo, 'package.json', JSON.stringify({ workspaces: ['apps/web'] }))

    const idx = baseIndex({
      structure: {
        isMonorepo: true,
        topLevelDirs: ['apps'],
        entryPoints: [],
        workspaces: ['apps/web'],
      },
    })
    const roots = resolveSourceRoot(repo, idx)
    expect(roots).toEqual([path.join(repo, 'apps/web/src')])
  })
})
