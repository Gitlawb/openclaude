import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VaultConfig } from '../types.js'
import type { NeedsInput } from './contract.js'
import {
  createStubProvider,
  createForbiddenProvider,
} from './promptProvider.js'
import { createResolverContext, resolveNeedsInput } from './resolver.js'

let localPath: string
let savedEnv: string | undefined

function makeCfg(): VaultConfig {
  return {
    local: { path: localPath },
    global: null,
    vaultPath: localPath,
    provider: 'generic',
    projectName: 'demo',
    projectRoot: '/tmp/demo',
  }
}

const baseNeeds: NeedsInput = {
  status: 'needs-input',
  kind: 'global-write-confirm',
  question: 'Write to global?',
  suggestedAnswers: ['no', 'yes'],
}

function readLog(): string {
  const p = join(localPath, '_log.md')
  return existsSync(p) ? readFileSync(p, 'utf-8') : ''
}

beforeEach(() => {
  localPath = mkdtempSync(join(tmpdir(), 'pifc-resolver-'))
  savedEnv = process.env.BRIDGEAI_AUTO_CONFIRM
  delete process.env.BRIDGEAI_AUTO_CONFIRM
})

afterEach(() => {
  if (savedEnv !== undefined) process.env.BRIDGEAI_AUTO_CONFIRM = savedEnv
  else delete process.env.BRIDGEAI_AUTO_CONFIRM
  rmSync(localPath, { recursive: true, force: true })
})

describe('resolveNeedsInput — branch coverage', () => {
  test('branch 1: yes-to-all hit returns suggested[0] + logs (auto: yes-to-all)', async () => {
    const ctx = createResolverContext(makeCfg(), { provider: createForbiddenProvider() })
    ctx.yesToAll.add(baseNeeds.kind)
    const r = await resolveNeedsInput(baseNeeds, ctx)
    expect(r).toEqual({ resolved: true, answer: 'no', autoAccepted: true })
    expect(readLog()).toContain('(auto: yes-to-all)')
  })

  test('branch 2: BRIDGEAI_AUTO_CONFIRM=true + suggested → returns suggested[0] + logs (auto: BRIDGEAI_AUTO_CONFIRM)', async () => {
    process.env.BRIDGEAI_AUTO_CONFIRM = 'true'
    const ctx = createResolverContext(makeCfg(), { provider: createForbiddenProvider() })
    const r = await resolveNeedsInput(baseNeeds, ctx)
    expect(r).toEqual({ resolved: true, answer: 'no', autoAccepted: true })
    expect(readLog()).toContain('(auto: BRIDGEAI_AUTO_CONFIRM)')
  })

  test('branch 3: BRIDGEAI_AUTO_CONFIRM=true + no suggested → aborted-no-default', async () => {
    process.env.BRIDGEAI_AUTO_CONFIRM = '1'
    const ctx = createResolverContext(makeCfg(), { provider: createForbiddenProvider() })
    const noSuggest: NeedsInput = { ...baseNeeds, suggestedAnswers: undefined }
    const r = await resolveNeedsInput(noSuggest, ctx)
    expect(r).toEqual({ resolved: false, reason: 'aborted-no-default' })
    expect(readLog()).toContain('reason=aborted-no-default')
  })

  test('branch 4: non-interactive (provider=null) + no auto → aborted-no-prompt', async () => {
    const ctx = createResolverContext(makeCfg()) // no provider
    const r = await resolveNeedsInput(baseNeeds, ctx)
    expect(r).toEqual({ resolved: false, reason: 'aborted-no-prompt' })
    expect(readLog()).toContain('reason=aborted-no-prompt')
  })

  test('branch 5a: interactive + dev answer → resolved + logs dev-confirmed', async () => {
    const ctx = createResolverContext(makeCfg(), {
      provider: createStubProvider(['yes']),
    })
    const r = await resolveNeedsInput(baseNeeds, ctx)
    expect(r).toEqual({ resolved: true, answer: 'yes', autoAccepted: false })
    const log = readLog()
    expect(log).toContain('dev-confirmed')
    expect(log).toContain('answer=yes')
    expect(log).not.toContain('(auto:')
  })

  test('branch 5b: interactive + EOF (provider returns null) → aborted-eof', async () => {
    const ctx = createResolverContext(makeCfg(), {
      provider: createStubProvider([null]),
    })
    const r = await resolveNeedsInput(baseNeeds, ctx)
    expect(r).toEqual({ resolved: false, reason: 'aborted-eof' })
    expect(readLog()).toContain('reason=aborted-eof')
  })

  test('yes-to-all literal: activates session flag + subsequent same-kind auto-accepts', async () => {
    const ctx = createResolverContext(makeCfg(), {
      provider: createStubProvider(['yes-to-all']),
    })
    const r1 = await resolveNeedsInput(baseNeeds, ctx)
    expect(r1.resolved).toBe(true)
    expect(ctx.yesToAll.has(baseNeeds.kind)).toBe(true)

    // Subsequent call (different question, same kind) auto-accepts via branch 1.
    // Swap to forbidden provider — must NOT prompt.
    ctx.provider = createForbiddenProvider()
    const r2 = await resolveNeedsInput({ ...baseNeeds, question: 'Again?' }, ctx)
    expect(r2).toEqual({ resolved: true, answer: 'no', autoAccepted: true })
  })

  test('BRIDGEAI_AUTO_CONFIRM=on (non-canonical) is treated as unset (strict opt-in)', async () => {
    process.env.BRIDGEAI_AUTO_CONFIRM = 'on'
    const ctx = createResolverContext(makeCfg()) // non-interactive
    const r = await resolveNeedsInput(baseNeeds, ctx)
    // Should hit branch 4 (non-interactive abort), not branch 2.
    expect(r).toEqual({ resolved: false, reason: 'aborted-no-prompt' })
  })

  test('malformed needs (missing kind) throws (programming bug, not user flow)', async () => {
    const ctx = createResolverContext(makeCfg())
    const bad = { status: 'needs-input', question: 'q', kind: '' } as NeedsInput
    await expect(resolveNeedsInput(bad, ctx)).rejects.toThrow(/malformed/)
  })
})
