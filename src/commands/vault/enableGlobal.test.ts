import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let savedEnv: string | undefined
let tmpHome: string

beforeEach(() => {
  savedEnv = process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  tmpHome = mkdtempSync(join(tmpdir(), 'pifb-enable-global-'))
  process.env.BRIDGEAI_MACHINE_CONFIG_PATH = join(tmpHome, 'config.json')
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  else process.env.BRIDGEAI_MACHINE_CONFIG_PATH = savedEnv
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('bridgeai vault enable-global', () => {
  test('flips declinedGlobalVault from true → false', async () => {
    const { saveMachineConfig, loadMachineConfig } = await import(
      '../../vault/globalConfig.js'
    )
    saveMachineConfig({ declinedGlobalVault: true })

    const mod = await import('./enableGlobal.js')
    const { call } = await mod.default.load()
    const result = await call('', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('re-enabled')
    expect(result.value).toContain('next `bridgeai` invocation will prompt')

    expect(loadMachineConfig().declinedGlobalVault).toBe(false)
  })

  test('no-op when not currently declined; prints status message', async () => {
    // No saved machine config at all.
    const mod = await import('./enableGlobal.js')
    const { call } = await mod.default.load()
    const result = await call('', {} as never)
    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('not currently declined')
  })
})
