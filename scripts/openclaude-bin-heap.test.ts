import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_HEAP_SIZE_MB,
  HEAP_PERCENTAGE_ENV,
  HEAP_PERCENTAGE_FLAG,
  HEAP_SIZE_ENV,
  HEAP_SIZE_FLAG,
  getAvailableMemoryBytes,
  hasHeapLimitFlag,
  heapSizeMbFromPercentage,
  parsePercentage,
  resolveHeapSizeMb,
  stripLauncherHeapArgs,
} from '../bin/heap-limit.mjs'

const BIN_PATH = join(import.meta.dir, '..', 'bin', 'openclaude')
const COMPILE_CACHE_PATH = join(import.meta.dir, '..', 'bin', 'node-compile-cache.mjs')
const HEAP_LIMIT_PATH = join(import.meta.dir, '..', 'bin', 'heap-limit.mjs')
const FOUR_GIB = 4 * 1024 * 1024 * 1024

describe('openclaude launcher heap guard', () => {
  test('raises the current Node heap before loading dist/cli.mjs', () => {
    const source = readFileSync(BIN_PATH, 'utf-8')
    const heapSource = readFileSync(HEAP_LIMIT_PATH, 'utf-8')

    expect(heapSource).toContain("export const HEAP_SIZE_FLAG = '--max-old-space-size'")
    expect(source).toContain('`${HEAP_SIZE_FLAG}=${resolved.mb}`')
    expect(source).toContain('--expose-gc')
    expect(source).toContain('spawnSync(process.execPath')
    expect(source).toContain("from './heap-limit.mjs'")
    const importingBranch = source.slice(source.indexOf('if (existsSync(distPath))'))
    const relaunchIndex = importingBranch.indexOf('relaunchWithLongSessionHeapIfNeeded()')
    const compileCacheIndex = importingBranch.indexOf('enableNodeCompileCacheIfAvailable()')
    const importIndex = importingBranch.indexOf("await import(pathToFileURL(distPath).href)")

    expect(relaunchIndex).toBeGreaterThanOrEqual(0)
    expect(compileCacheIndex).toBeGreaterThan(relaunchIndex)
    expect(importIndex).toBeGreaterThan(compileCacheIndex)
  })

  test('keeps user and troubleshooting escape hatches', () => {
    const source = readFileSync(BIN_PATH, 'utf-8')
    const heapSource = readFileSync(HEAP_LIMIT_PATH, 'utf-8')

    expect(source).toContain('OPENCLAUDE_DISABLE_HEAP_RELAUNCH')
    expect(source).toContain('HEAP_SIZE_ENV')
    expect(heapSource).toContain(HEAP_SIZE_ENV)
    expect(source).toContain('process.env.NODE_OPTIONS')
    expect(source).toContain('hasHeapLimitFlag(nodeArgs)')
    expect(heapSource).toContain(HEAP_PERCENTAGE_FLAG)
  })

  test('feature-detects the compile-cache API without a named builtin import', () => {
    const source = readFileSync(COMPILE_CACHE_PATH, 'utf-8')

    expect(source).toContain("import * as nodeModule from 'node:module'")
    expect(source).not.toMatch(/import\s*\{[^}]*enableCompileCache[^}]*\}\s*from\s*['"]node:module['"]/s)
  })
})

describe('heap-limit percentage resolution', () => {
  test('parses Node-style percentages including a trailing percent sign', () => {
    expect(parsePercentage('50')).toBe(50)
    expect(parsePercentage('75%')).toBe(75)
    expect(parsePercentage('100')).toBe(100)
    expect(parsePercentage('0.5')).toBe(0.5)
    expect(parsePercentage('0')).toBeNull()
    expect(parsePercentage('101')).toBeNull()
    expect(parsePercentage('')).toBeNull()
    expect(parsePercentage('nope')).toBeNull()
  })

  test('converts a percentage of constrained memory into megabytes', () => {
    expect(heapSizeMbFromPercentage(50, FOUR_GIB)).toBe(2048)
    expect(heapSizeMbFromPercentage(50, 2 * 1024 * 1024 * 1024)).toBe(1024)
    expect(heapSizeMbFromPercentage(100, FOUR_GIB)).toBe(4096)
    expect(heapSizeMbFromPercentage(50, 0)).toBeNull()
    expect(heapSizeMbFromPercentage(50, 512 * 1024)).toBe(1)
  })

  test('prefers constrained memory over host totalmem', () => {
    expect(
      getAvailableMemoryBytes({
        constrainedMemory: () => 2 * 1024 * 1024 * 1024,
        totalmem: () => FOUR_GIB,
      }),
    ).toBe(2 * 1024 * 1024 * 1024)
    expect(
      getAvailableMemoryBytes({
        constrainedMemory: () => 0,
        totalmem: () => FOUR_GIB,
      }),
    ).toBe(FOUR_GIB)
    expect(
      getAvailableMemoryBytes({
        constrainedMemory: () => 18446744073709552000,
        totalmem: () => FOUR_GIB,
      }),
    ).toBe(FOUR_GIB)
  })

  test('treats native percentage flags as an existing heap limit', () => {
    expect(hasHeapLimitFlag(['--max-old-space-size-percentage=50'])).toBe(true)
    expect(hasHeapLimitFlag(['--max-old-space-size=4096'])).toBe(true)
    expect(hasHeapLimitFlag(['--inspect=9229'])).toBe(false)
  })

  test('resolves --max-old-space-size-percentage from argv before the MB env', () => {
    const resolved = resolveHeapSizeMb({
      argv: ['--max-old-space-size-percentage=50', '--print'],
      env: { [HEAP_SIZE_ENV]: '4096' },
      availableBytes: FOUR_GIB,
    })
    expect(resolved).toEqual({
      mb: 2048,
      source: 'argv-percentage',
      percentage: 50,
    })
  })

  test('accepts a spaced percentage flag and strips launcher-only args', () => {
    const resolved = resolveHeapSizeMb({
      argv: ['--max-old-space-size-percentage', '25', 'fix tests'],
      env: {},
      availableBytes: FOUR_GIB,
    })
    expect(resolved.mb).toBe(1024)
    expect(stripLauncherHeapArgs([
      '--max-old-space-size-percentage',
      '25',
      '--max-memory=1024',
      'fix tests',
    ])).toEqual(['fix tests'])
  })

  test('OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_PERCENTAGE sizes the heap from RAM', () => {
    const resolved = resolveHeapSizeMb({
      argv: [],
      env: { [HEAP_PERCENTAGE_ENV]: '75' },
      availableBytes: FOUR_GIB,
    })
    expect(resolved).toEqual({
      mb: 3072,
      source: 'env-percentage',
      percentage: 75,
    })
  })

  test('--max-memory still wins over a percentage request', () => {
    const resolved = resolveHeapSizeMb({
      argv: ['--max-old-space-size-percentage=50', '--max-memory=1536'],
      env: { [HEAP_PERCENTAGE_ENV]: '90' },
      availableBytes: FOUR_GIB,
    })
    expect(resolved).toEqual({
      mb: 1536,
      source: 'max-memory',
      setMaxMemoryEnv: true,
    })
  })

  test('clamps a sub-megabyte percentage to 1 MB instead of the 8192 default', () => {
    expect(
      resolveHeapSizeMb({
        argv: ['--max-old-space-size-percentage=50'],
        env: {},
        availableBytes: 512 * 1024,
      }),
    ).toEqual({
      mb: 1,
      source: 'argv-percentage',
      percentage: 50,
    })
  })

  test('falls back to the 8192 MB default when no override is set', () => {
    expect(resolveHeapSizeMb({ argv: [], env: {} })).toEqual({
      mb: DEFAULT_HEAP_SIZE_MB,
      source: 'default',
    })
  })

  test('ignores an invalid percentage and uses the next source', () => {
    expect(
      resolveHeapSizeMb({
        argv: ['--max-old-space-size-percentage=0'],
        env: { [HEAP_SIZE_ENV]: '4096' },
        availableBytes: FOUR_GIB,
      }),
    ).toEqual({ mb: 4096, source: 'env-mb' })
  })
})
