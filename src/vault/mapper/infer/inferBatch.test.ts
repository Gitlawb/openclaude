import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { inferBatch } from './inferBatch.js'
import type { SemanticProvider } from './semanticCall.js'
import type { PromptInput } from './promptBuilder.js'

function makeTmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-batch-'))
  mkdirSync(path.join(dir, 'src', 'a'), { recursive: true })
  mkdirSync(path.join(dir, 'src', 'b'), { recursive: true })
  mkdirSync(path.join(dir, 'src', 'c'), { recursive: true })
  writeFileSync(path.join(dir, 'src', 'a', 'index.ts'), 'export const a = 1\n', 'utf-8')
  writeFileSync(path.join(dir, 'src', 'b', 'index.ts'), 'export const b = 2\n', 'utf-8')
  writeFileSync(path.join(dir, 'src', 'c', 'index.ts'), 'export const c = 3\n', 'utf-8')
  return dir
}

function makeInputs(tmp: string): PromptInput[] {
  return ['a', 'b', 'c'].map((name) => ({
    slug: `mod-${name}`,
    sourcePath: path.join(tmp, 'src', name),
    files: [path.join(tmp, 'src', name, 'index.ts')],
    repoRoot: tmp,
    exports: [name],
    imports: [],
  }))
}

const validResponse = (domain: string) =>
  JSON.stringify({
    summary: `Module ${domain}`,
    responsibilities: ['A', 'B', 'C'],
    domain,
    layer: 'service',
  })

describe('inferBatch', () => {
  let tmp: string

  beforeEach(() => { tmp = makeTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('returns results in input order', async () => {
    const provider: SemanticProvider = {
      async complete() {
        return { content: validResponse('test'), tokensIn: 5, tokensOut: 10 }
      },
    }

    const results = await inferBatch(makeInputs(tmp), provider)

    expect(results).toHaveLength(3)
    for (const r of results) {
      expect(r.fallback).toBe(false)
      expect(r.domain).toBe('test')
    }
  })

  test('respects concurrency limit', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const provider: SemanticProvider = {
      async complete() {
        currentConcurrent++
        if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent
        // Simulate some async work
        await new Promise((r) => setTimeout(r, 20))
        currentConcurrent--
        return { content: validResponse('test'), tokensIn: 5, tokensOut: 10 }
      },
    }

    await inferBatch(makeInputs(tmp), provider, { concurrency: 2 })

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })
})
