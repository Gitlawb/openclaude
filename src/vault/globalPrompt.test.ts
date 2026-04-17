import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VaultConfig } from './types.js'
import {
  createForbiddenProvider,
  createResolverContext,
  createStubProvider,
} from './escapeHatch/index.js'
import {
  loadMachineConfig,
  saveMachineConfig,
} from './globalConfig.js'
import { maybePromptForGlobalVault } from './globalPrompt.js'

let savedMachineEnv: string | undefined
let savedGlobalEnv: string | undefined
let savedDefaultEnv: string | undefined
let tmpHome: string

function makeCfg(): VaultConfig {
  // Local vault — doesn't need to exist for the prompt code path.
  return {
    local: { path: join(tmpHome, 'local-vault') },
    global: null,
    vaultPath: join(tmpHome, 'local-vault'),
    provider: 'generic',
    projectName: 'demo',
    projectRoot: tmpHome,
  }
}

beforeEach(() => {
  savedMachineEnv = process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  savedGlobalEnv = process.env.BRIDGEAI_GLOBAL_VAULT
  savedDefaultEnv = process.env.BRIDGEAI_DEFAULT_GLOBAL_VAULT_PATH
  tmpHome = mkdtempSync(join(tmpdir(), 'pifb-prompt-'))
  process.env.BRIDGEAI_MACHINE_CONFIG_PATH = join(tmpHome, 'machine-config.json')
  // Override the default global vault path so bootstrap doesn't touch
  // the dev's real $HOME.
  process.env.BRIDGEAI_DEFAULT_GLOBAL_VAULT_PATH = join(tmpHome, 'global-vault')
  delete process.env.BRIDGEAI_GLOBAL_VAULT
})

afterEach(() => {
  if (savedMachineEnv === undefined) delete process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  else process.env.BRIDGEAI_MACHINE_CONFIG_PATH = savedMachineEnv
  if (savedGlobalEnv === undefined) delete process.env.BRIDGEAI_GLOBAL_VAULT
  else process.env.BRIDGEAI_GLOBAL_VAULT = savedGlobalEnv
  if (savedDefaultEnv === undefined) delete process.env.BRIDGEAI_DEFAULT_GLOBAL_VAULT_PATH
  else process.env.BRIDGEAI_DEFAULT_GLOBAL_VAULT_PATH = savedDefaultEnv
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('maybePromptForGlobalVault', () => {
  test('already-configured (env or saved path) → no prompt invoked, returns existing', async () => {
    saveMachineConfig({ globalVaultPath: '/already/here' })
    const ctx = createResolverContext(makeCfg(), {
      provider: createForbiddenProvider(),
    })
    const r = await maybePromptForGlobalVault(ctx)
    expect(r).toEqual({
      kind: 'configured',
      path: '/already/here',
      source: 'config',
    })
  })

  test('already-declined → no prompt invoked, returns declined', async () => {
    saveMachineConfig({ declinedGlobalVault: true })
    const ctx = createResolverContext(makeCfg(), {
      provider: createForbiddenProvider(),
    })
    const r = await maybePromptForGlobalVault(ctx)
    expect(r).toEqual({ kind: 'declined' })
  })

  test('unconfigured + dev says yes → bootstraps default path, returns configured', async () => {
    const ctx = createResolverContext(makeCfg(), {
      provider: createStubProvider(['yes']),
    })
    const r = await maybePromptForGlobalVault(ctx)
    expect(r.kind).toBe('configured')
    if (r.kind !== 'configured') return
    // Default path lands under tmpHome (HOME override).
    expect(r.path).toContain(tmpHome)
    expect(r.path).toContain('global-vault')
    expect(existsSync(join(r.path, '.git'))).toBe(true)
    expect(existsSync(join(r.path, '_index.md'))).toBe(true)
    expect(loadMachineConfig().globalVaultPath).toBe(r.path)
  })

  test('unconfigured + dev says no → records decline, returns declined, no bootstrap', async () => {
    const ctx = createResolverContext(makeCfg(), {
      provider: createStubProvider(['no']),
    })
    const r = await maybePromptForGlobalVault(ctx)
    expect(r).toEqual({ kind: 'declined' })
    expect(loadMachineConfig().declinedGlobalVault).toBe(true)
    expect(existsSync(join(tmpHome, 'global-vault'))).toBe(false)
  })

  test('unconfigured + non-interactive (no provider, no auto-confirm) → resolver aborts → treated as decline', async () => {
    // Non-interactive context; resolver returns aborted-no-prompt; we
    // treat that as decline (do NOT silently bootstrap).
    const ctx = createResolverContext(makeCfg()) // provider: null
    const r = await maybePromptForGlobalVault(ctx)
    expect(r).toEqual({ kind: 'declined' })
    expect(loadMachineConfig().declinedGlobalVault).toBe(true)
  })
})
