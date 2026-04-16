import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { callSemanticPass, type SemanticProvider } from './semanticCall.js'
import type { PromptInput } from './promptBuilder.js'

function makeTmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridgeai-sem-'))
  mkdirSync(path.join(dir, 'src', 'mod'), { recursive: true })
  writeFileSync(path.join(dir, 'src', 'mod', 'index.ts'), 'export const x = 1\n', 'utf-8')
  return dir
}

function makeInput(tmp: string): PromptInput {
  return {
    slug: 'test-mod',
    sourcePath: path.join(tmp, 'src', 'mod'),
    files: [path.join(tmp, 'src', 'mod', 'index.ts')],
    repoRoot: tmp,
    exports: ['x'],
    imports: [],
  }
}

const VALID_RESPONSE = JSON.stringify({
  summary: 'A test module for unit testing.',
  responsibilities: ['Does thing A', 'Does thing B', 'Does thing C'],
  domain: 'testing',
  layer: 'utility',
})

function stubProvider(responses: Array<{ content: string; tokensIn?: number; tokensOut?: number } | Error>): SemanticProvider {
  let callIdx = 0
  return {
    async complete() {
      const r = responses[callIdx++]
      if (!r) throw new Error('No more stub responses')
      if (r instanceof Error) throw r
      return { content: r.content, tokensIn: r.tokensIn ?? 10, tokensOut: r.tokensOut ?? 20 }
    },
  }
}

describe('callSemanticPass', () => {
  let tmp: string

  beforeEach(() => { tmp = makeTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('valid JSON → SemanticResult populated, fallback: false', async () => {
    const provider = stubProvider([{ content: VALID_RESPONSE }])
    const result = await callSemanticPass(makeInput(tmp), provider)

    expect(result.fallback).toBe(false)
    expect(result.summary).toBe('A test module for unit testing.')
    expect(result.domain).toBe('testing')
    expect(result.layer).toBe('utility')
    expect(result.responsibilities).toHaveLength(3)
    expect(result.tokensIn).toBe(10)
    expect(result.tokensOut).toBe(20)
  })

  test('invalid JSON first try, valid on retry → success', async () => {
    const provider = stubProvider([
      { content: 'not json' },
      { content: VALID_RESPONSE },
    ])
    const result = await callSemanticPass(makeInput(tmp), provider)

    expect(result.fallback).toBe(false)
    expect(result.summary).toBe('A test module for unit testing.')
  })

  test('provider failing twice → fallback: true, placeholders', async () => {
    const provider = stubProvider([
      { content: 'not json' },
      { content: 'still not json' },
    ])
    const result = await callSemanticPass(makeInput(tmp), provider)

    expect(result.fallback).toBe(true)
    expect(result.summary).toContain('pending')
  })

  test('provider throwing network error → fallback: true', async () => {
    const provider = stubProvider([
      new Error('network-error'),
      new Error('network-error'),
    ])
    const result = await callSemanticPass(makeInput(tmp), provider)

    expect(result.fallback).toBe(true)
  })

  test('disableLlm: true → never calls provider, returns fallback', async () => {
    let called = false
    const provider: SemanticProvider = {
      async complete() {
        called = true
        return { content: VALID_RESPONSE, tokensIn: 0, tokensOut: 0 }
      },
    }

    const result = await callSemanticPass(makeInput(tmp), provider, { disableLlm: true })

    expect(called).toBe(false)
    expect(result.fallback).toBe(true)
    expect(result.tokensIn).toBe(0)
    expect(result.tokensOut).toBe(0)
  })

  test('schema violation (too few responsibilities) → retry then fallback', async () => {
    const badSchema = JSON.stringify({
      summary: 'A module',
      responsibilities: ['Only one'],
      domain: 'test',
      layer: 'service',
    })
    const provider = stubProvider([
      { content: badSchema },
      { content: badSchema },
    ])
    const result = await callSemanticPass(makeInput(tmp), provider)

    expect(result.fallback).toBe(true)
  })
})
