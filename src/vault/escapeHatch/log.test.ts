import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VaultConfig } from '../types.js'
import type { NeedsInput } from './contract.js'
import { appendDevConfirmed, appendDevAborted } from './log.js'

let localPath: string
let globalPath: string

function makeCfg(opts: { withGlobal: boolean }): VaultConfig {
  return {
    local: { path: localPath },
    global: opts.withGlobal ? { path: globalPath } : null,
    vaultPath: localPath,
    provider: 'generic',
    projectName: 'demo',
    projectRoot: '/tmp/demo',
  }
}

const baseNeeds: NeedsInput = {
  status: 'needs-input',
  kind: 'global-write-confirm',
  question: 'Write this note to the global vault?',
}

beforeEach(() => {
  localPath = mkdtempSync(join(tmpdir(), 'pifc-log-local-'))
  globalPath = mkdtempSync(join(tmpdir(), 'pifc-log-global-'))
})

afterEach(() => {
  rmSync(localPath, { recursive: true, force: true })
  rmSync(globalPath, { recursive: true, force: true })
})

describe('appendDevConfirmed', () => {
  test('writes line to local _log.md by default (no affectedVault set)', () => {
    appendDevConfirmed(makeCfg({ withGlobal: false }), baseNeeds, 'yes', null)
    const content = readFileSync(join(localPath, '_log.md'), 'utf-8')
    expect(content).toContain('dev-confirmed')
    expect(content).toContain('global-write-confirm')
    expect(content).toContain('answer=yes')
    expect(content).toContain('source: code-analysis')
    expect(content).not.toContain('(auto:')
  })

  test('routes to global vault when affectedVault=global and cfg.global is set', () => {
    const needs: NeedsInput = { ...baseNeeds, affectedVault: 'global' }
    appendDevConfirmed(makeCfg({ withGlobal: true }), needs, 'yes', null)
    expect(existsSync(join(globalPath, '_log.md'))).toBe(true)
    expect(existsSync(join(localPath, '_log.md'))).toBe(false)
  })

  test('falls back to local when affectedVault=global but cfg.global is null', () => {
    const needs: NeedsInput = { ...baseNeeds, affectedVault: 'global' }
    appendDevConfirmed(makeCfg({ withGlobal: false }), needs, 'no', null)
    expect(existsSync(join(localPath, '_log.md'))).toBe(true)
    expect(existsSync(join(globalPath, '_log.md'))).toBe(false)
  })

  test('appends `(auto: <marker>)` when autoMarker is set', () => {
    appendDevConfirmed(
      makeCfg({ withGlobal: false }),
      baseNeeds,
      'yes',
      'BRIDGEAI_AUTO_CONFIRM',
    )
    const content = readFileSync(join(localPath, '_log.md'), 'utf-8')
    expect(content).toContain('(auto: BRIDGEAI_AUTO_CONFIRM)')
  })

  test('writes second entry under `# Vault log` header preserved', () => {
    appendDevConfirmed(makeCfg({ withGlobal: false }), baseNeeds, 'yes', null)
    appendDevConfirmed(makeCfg({ withGlobal: false }), baseNeeds, 'no', null)
    const content = readFileSync(join(localPath, '_log.md'), 'utf-8')
    expect(content.match(/dev-confirmed/g)?.length).toBe(2)
    expect(content.startsWith('# Vault log\n')).toBe(true)
  })
})

describe('appendDevAborted', () => {
  test('writes line with reason', () => {
    appendDevAborted(makeCfg({ withGlobal: false }), baseNeeds, 'aborted-eof')
    const content = readFileSync(join(localPath, '_log.md'), 'utf-8')
    expect(content).toContain('dev-aborted')
    expect(content).toContain('reason=aborted-eof')
  })
})
