import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const BIN_PATH = join(import.meta.dir, '..', 'bin', 'openclaude')

describe('openclaude launcher heap guard', () => {
  test('raises the current Node heap before loading dist/cli.mjs', () => {
    const source = readFileSync(BIN_PATH, 'utf-8')

    expect(source).toContain('--max-old-space-size=')
    expect(source).toContain('--expose-gc')
    expect(source).toContain('spawnSync(process.execPath')
    expect(source.indexOf('relaunchWithLongSessionHeapIfNeeded()')).toBeLessThan(
      source.indexOf("await import(pathToFileURL(distPath).href)"),
    )
  })

  test('keeps user and troubleshooting escape hatches', () => {
    const source = readFileSync(BIN_PATH, 'utf-8')

    expect(source).toContain('OPENCLAUDE_DISABLE_HEAP_RELAUNCH')
    expect(source).toContain('OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_MB')
    expect(source).toContain('process.env.NODE_OPTIONS')
    expect(source).toContain("hasNodeOptionFlag('--max-old-space-size')")
  })
})
