import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const BIN_PATH = join(import.meta.dir, '..', 'bin', 'openclaude')
const COMPILE_CACHE_PATH = join(import.meta.dir, '..', 'bin', 'node-compile-cache.mjs')

describe('openclaude launcher heap guard', () => {
  test('raises the current Node heap before loading dist/cli.mjs', () => {
    const source = readFileSync(BIN_PATH, 'utf-8')

    expect(source).toContain('--max-old-space-size=')
    expect(source).toContain('--expose-gc')
    expect(source).toContain('spawnSync(process.execPath')
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

    expect(source).toContain('OPENCLAUDE_DISABLE_HEAP_RELAUNCH')
    expect(source).toContain('OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_MB')
    expect(source).toContain('process.env.NODE_OPTIONS')
    expect(source).toContain("hasNodeOptionFlag('--max-old-space-size')")
  })

  test('feature-detects the compile-cache API without a named builtin import', () => {
    const source = readFileSync(COMPILE_CACHE_PATH, 'utf-8')

    expect(source).toContain("import * as nodeModule from 'node:module'")
    expect(source).not.toMatch(/import\s*\{[^}]*enableCompileCache[^}]*\}\s*from\s*['"]node:module['"]/s)
  })
})
