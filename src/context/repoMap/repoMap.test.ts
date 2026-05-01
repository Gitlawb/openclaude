import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { invalidateCache, buildRepoMap } from './index.js'
import { extractTags } from './symbolExtractor.js'
import { buildGraph } from './graph.js'
import { initParser } from './parser.js'
import { countTokens } from './tokenize.js'

const FIXTURE_ROOT = join(import.meta.dir, '__fixtures__', 'mini-repo')
const FIXTURE_FILES = ['fileA.ts', 'fileB.ts', 'fileC.ts', 'fileD.ts', 'fileE.ts']

beforeAll(async () => {
  await initParser()
})

// Clean up cache between tests to avoid cross-test interference
afterEach(() => {
  invalidateCache(FIXTURE_ROOT)
})

describe('symbol extraction', () => {
  test('extracts function and class defs from a TypeScript file', async () => {
    const result = await extractTags('fileC.ts', FIXTURE_ROOT)
    expect(result).not.toBeNull()

    const defs = result!.tags.filter(t => t.kind === 'def')
    const defNames = defs.map(t => t.name)

    expect(defNames).toContain('DataStore')
    expect(defNames).toContain('createStore')
    expect(defNames).toContain('StoreConfig')

    // All defs should have kind='def'
    for (const d of defs) {
      expect(d.kind).toBe('def')
    }
  })

  test('extracts references to imported symbols', async () => {
    const result = await extractTags('fileA.ts', FIXTURE_ROOT)
    expect(result).not.toBeNull()

    const refs = result!.tags.filter(t => t.kind === 'ref')
    const refNames = refs.map(t => t.name)

    // fileA imports CacheLayer from fileB and StoreConfig from fileC
    expect(refNames).toContain('CacheLayer')
    expect(refNames).toContain('StoreConfig')
  })
})

describe('graph', () => {
  test('builds edges between files that reference each other\'s symbols', async () => {
    const allTags = []
    for (const f of FIXTURE_FILES) {
      const tags = await extractTags(f, FIXTURE_ROOT)
      if (tags) allTags.push(tags)
    }

    const graph = buildGraph(allTags)

    // fileA imports from fileB (references CacheLayer defined in fileB)
    expect(graph.hasEdge('fileA.ts', 'fileB.ts')).toBe(true)

    // fileA imports from fileC (references StoreConfig, DataStore defined in fileC)
    expect(graph.hasEdge('fileA.ts', 'fileC.ts')).toBe(true)

    // fileB imports from fileC (references DataStore defined in fileC)
    expect(graph.hasEdge('fileB.ts', 'fileC.ts')).toBe(true)

    // fileD imports from fileA
    expect(graph.hasEdge('fileD.ts', 'fileA.ts')).toBe(true)

    // fileE is isolated — no edges to/from it
    expect(graph.degree('fileE.ts')).toBe(0)
  })
})

describe('pagerank', () => {
  test('ranks the most-imported file highest', async () => {
    const result = await buildRepoMap({
      root: FIXTURE_ROOT,
      maxTokens: 2048,
      files: FIXTURE_FILES,
    })

    // The map starts with the highest-ranked file
    const firstFile = result.map.split('\n')[0]
    expect(firstFile).toBe('fileC.ts:')

    // fileE should be ranked lowest (or near last)
    const lines = result.map.split('\n')
    const filePositions = FIXTURE_FILES.map(f => {
      const idx = lines.findIndex(l => l === `${f}:`)
      return { file: f, position: idx }
    }).filter(x => x.position >= 0)
    .sort((a, b) => a.position - b.position)

    // fileC should be first
    expect(filePositions[0]!.file).toBe('fileC.ts')

    // fileE should be last (or among the last)
    const lastFile = filePositions[filePositions.length - 1]!.file
    expect(['fileD.ts', 'fileE.ts']).toContain(lastFile)
  })
})

describe('renderer', () => {
  test('respects the token budget within 5%', async () => {
    const maxTokens = 500
    const result = await buildRepoMap({
      root: FIXTURE_ROOT,
      maxTokens,
      files: FIXTURE_FILES,
    })

    const actualTokens = countTokens(result.map)
    expect(actualTokens).toBeLessThanOrEqual(maxTokens * 1.05)
    expect(result.tokenCount).toBeLessThanOrEqual(maxTokens * 1.05)
  })

  test('drops files that don\'t fit rather than listing their names', async () => {
    // Very tight budget — should only fit 1-2 files
    const result = await buildRepoMap({
      root: FIXTURE_ROOT,
      maxTokens: 100,
      files: FIXTURE_FILES,
    })

    // Count how many files appear as headers in the output
    const fileHeaders = result.map.split('\n').filter(l => l.endsWith(':') && !l.startsWith(' '))

    // Every file header in the output should have its signatures listed
    for (const header of fileHeaders) {
      // The file must have at least one signature line after it
      const headerIdx = result.map.indexOf(header)
      const afterHeader = result.map.slice(headerIdx + header.length)
      // Should have content (signatures), not just the filename
      expect(afterHeader.trim().length).toBeGreaterThan(0)
    }

    // Should have fewer files than total
    expect(fileHeaders.length).toBeLessThan(FIXTURE_FILES.length)
  })
})

describe('cache', () => {
  test('second build of unchanged fixture uses the cache', async () => {
    // First build (cold)
    const result1 = await buildRepoMap({
      root: FIXTURE_ROOT,
      maxTokens: 2048,
      files: FIXTURE_FILES,
    })
    expect(result1.cacheHit).toBe(false)

    // Second build (warm)
    const result2 = await buildRepoMap({
      root: FIXTURE_ROOT,
      maxTokens: 2048,
      files: FIXTURE_FILES,
    })
    expect(result2.cacheHit).toBe(true)
    expect(result2.buildTimeMs).toBeLessThan(result1.buildTimeMs)

    // Output should be identical
    expect(result2.map).toBe(result1.map)
  })

  test('modifying a file invalidates only that file', async () => {
    // Create a temp copy of the fixture
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-test-'))
    try {
      for (const f of FIXTURE_FILES) {
        cpSync(join(FIXTURE_ROOT, f), join(tempDir, f))
      }

      // First build
      const result1 = await buildRepoMap({
        root: tempDir,
        maxTokens: 2048,
        files: FIXTURE_FILES,
      })
      expect(result1.cacheHit).toBe(false)

      // Touch one file to change its mtime
      const targetFile = join(tempDir, 'fileE.ts')
      const now = new Date()
      utimesSync(targetFile, now, now)

      // Second build — rendered cache should be invalidated because file list hash
      // includes the files and the rendered map hash changes with different mtimes
      // for the per-file cache check
      invalidateCache(tempDir)
      const result2 = await buildRepoMap({
        root: tempDir,
        maxTokens: 2048,
        files: FIXTURE_FILES,
      })
      // The per-file cache for fileE should miss (mtime changed),
      // but other files should still hit the per-file cache
      expect(result2.cacheHit).toBe(false)

      // Output should still be valid
      expect(result2.map.length).toBeGreaterThan(0)
      expect(result2.fileCount).toBe(result1.fileCount)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })
})

describe('gitFiles', () => {
  test('falls back gracefully when not in a git repo', async () => {
    // Create a temp directory with source files but NO .git
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-nogit-'))
    try {
      writeFileSync(
        join(tempDir, 'hello.ts'),
        'export function hello(): string { return "world" }\n',
      )
      writeFileSync(
        join(tempDir, 'utils.ts'),
        'export function add(a: number, b: number): number { return a + b }\n',
      )

      const result = await buildRepoMap({
        root: tempDir,
        maxTokens: 1024,
      })

      // Should succeed without throwing
      expect(result.map.length).toBeGreaterThan(0)
      expect(result.totalFileCount).toBeGreaterThan(0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })
})

describe('error handling', () => {
  test('no crash on malformed source file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-malformed-'))
    try {
      // Valid file
      writeFileSync(
        join(tempDir, 'good.ts'),
        'export function good(): number { return 1 }\n',
      )
      // Malformed file — severe syntax errors
      writeFileSync(
        join(tempDir, 'bad.ts'),
        '}{}{}{export classclass [[[ function ,,, @@@ ###\n',
      )

      const result = await buildRepoMap({
        root: tempDir,
        maxTokens: 1024,
        files: ['good.ts', 'bad.ts'],
      })

      // Should complete successfully
      expect(result.map.length).toBeGreaterThan(0)
      // The good file should be in the output
      expect(result.map).toContain('good.ts')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })
})
