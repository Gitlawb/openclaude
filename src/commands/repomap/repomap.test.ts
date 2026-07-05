import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { invalidateCache } from '../../context/repoMap/index.js'
import { parseArgs, runRepoMapCommand } from './repomap.js'

async function runTextCommand(args: string, root: string): Promise<string> {
  const result = await runRepoMapCommand(args, root)
  if (result.type !== 'text') {
    throw new Error(`/repomap must return type:'text', got ${result.type}`)
  }
  return result.value
}

describe('/repomap argument parsing', () => {
  test('defaults to 2048 tokens with no flags', () => {
    const result = parseArgs('')
    expect(result.tokens).toBe(2048)
    expect(result.focus).toEqual([])
    expect(result.invalidate).toBe(false)
    expect(result.stats).toBe(false)
  })

  test('parses --tokens flag', () => {
    const result = parseArgs('--tokens 4096')
    expect(result.tokens).toBe(4096)
  })

  test('rejects --tokens below 256', () => {
    const result = parseArgs('--tokens 100')
    expect(result.tokens).toBe(2048) // falls back to default
  })

  test('rejects --tokens above 16384', () => {
    const result = parseArgs('--tokens 20000')
    expect(result.tokens).toBe(2048) // falls back to default
  })

  test('parses --focus flag', () => {
    const result = parseArgs('--focus src/tools/')
    expect(result.focus).toEqual(['src/tools/'])
  })

  test('parses multiple --focus flags', () => {
    const result = parseArgs('--focus src/tools/ --focus src/context.ts')
    expect(result.focus).toEqual(['src/tools/', 'src/context.ts'])
  })

  test('parses --invalidate flag', () => {
    const result = parseArgs('--invalidate')
    expect(result.invalidate).toBe(true)
    expect(result.stats).toBe(false)
  })

  test('parses --stats flag', () => {
    const result = parseArgs('--stats')
    expect(result.stats).toBe(true)
    expect(result.invalidate).toBe(false)
  })

  test('parses combined flags', () => {
    const result = parseArgs('--tokens 2048 --focus src/tools/ --invalidate')
    expect(result.tokens).toBe(2048)
    expect(result.focus).toEqual(['src/tools/'])
    expect(result.invalidate).toBe(true)
  })
})

describe('/repomap command', () => {
  test('builds a repository map using the default token budget', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-command-'))
    try {
      writeFileSync(
        join(tempDir, 'main.ts'),
        'export function main(): string { return "hello" }\n',
      )

      const value = await runTextCommand('', tempDir)

      expect(value).toContain('Repository map:')
      expect(value).toContain('main.ts:')
      expect(value).toContain('Tokens:')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })

  test('reports cache stats without building a map', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-command-'))
    try {
      const value = await runTextCommand('--stats', tempDir)

      expect(value).toContain('Repository map cache stats:')
      expect(value).toContain('Cached entries:')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })

  test('invalidates and rebuilds the cache', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-command-'))
    try {
      writeFileSync(
        join(tempDir, 'main.ts'),
        'export function value(): number { return 1 }\n',
      )

      const value = await runTextCommand('--invalidate --tokens 512', tempDir)

      expect(value).toContain('Cache invalidated and rebuilt.')
      expect(value).toContain('main.ts:')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })
})
