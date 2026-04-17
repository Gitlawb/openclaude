import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadMachineConfig,
  saveMachineConfig,
  resolveMachineConfigPath,
  resolveGlobalVault,
} from './globalConfig.js'

let savedEnv: string | undefined
let savedGlobalEnv: string | undefined
let tmpHome: string

beforeEach(() => {
  savedEnv = process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  savedGlobalEnv = process.env.BRIDGEAI_GLOBAL_VAULT
  tmpHome = mkdtempSync(join(tmpdir(), 'pifb-machinecfg-'))
  process.env.BRIDGEAI_MACHINE_CONFIG_PATH = join(tmpHome, 'config.json')
  delete process.env.BRIDGEAI_GLOBAL_VAULT
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  else process.env.BRIDGEAI_MACHINE_CONFIG_PATH = savedEnv
  if (savedGlobalEnv === undefined) delete process.env.BRIDGEAI_GLOBAL_VAULT
  else process.env.BRIDGEAI_GLOBAL_VAULT = savedGlobalEnv
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('machine config — load + save', () => {
  test('loadMachineConfig returns {} when file missing', () => {
    expect(loadMachineConfig()).toEqual({})
  })

  test('loadMachineConfig returns {} when file malformed (non-JSON)', () => {
    writeFileSync(resolveMachineConfigPath(), 'not json at all\n', 'utf-8')
    expect(loadMachineConfig()).toEqual({})
  })

  test('loadMachineConfig returns {} when file is JSON null/array', () => {
    writeFileSync(resolveMachineConfigPath(), 'null', 'utf-8')
    expect(loadMachineConfig()).toEqual({})
  })

  test('saveMachineConfig + loadMachineConfig round-trips', () => {
    saveMachineConfig({ globalVaultPath: '/x', declinedGlobalVault: false })
    expect(loadMachineConfig()).toEqual({
      globalVaultPath: '/x',
      declinedGlobalVault: false,
    })
  })

  test('saveMachineConfig sets file mode 0600', () => {
    saveMachineConfig({ globalVaultPath: '/x' })
    const mode = statSync(resolveMachineConfigPath()).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test('saveMachineConfig creates the parent directory when missing', () => {
    rmSync(tmpHome, { recursive: true, force: true })
    saveMachineConfig({ globalVaultPath: '/x' })
    expect(existsSync(resolveMachineConfigPath())).toBe(true)
  })
})

describe('resolveGlobalVault — priority order', () => {
  test('env set → configured (source: env), regardless of config state', () => {
    process.env.BRIDGEAI_GLOBAL_VAULT = '/from/env'
    saveMachineConfig({ declinedGlobalVault: true }) // would otherwise win
    const r = resolveGlobalVault()
    expect(r).toEqual({ kind: 'configured', path: '/from/env', source: 'env' })
  })

  test('env unset + declined config → declined', () => {
    saveMachineConfig({ declinedGlobalVault: true })
    expect(resolveGlobalVault()).toEqual({ kind: 'declined' })
  })

  test('env unset + config has globalVaultPath → configured (source: config)', () => {
    saveMachineConfig({ globalVaultPath: '/from/config' })
    const r = resolveGlobalVault()
    expect(r).toEqual({
      kind: 'configured',
      path: '/from/config',
      source: 'config',
    })
  })

  test('env unset + empty config → unconfigured (with default path)', () => {
    const r = resolveGlobalVault()
    expect(r.kind).toBe('unconfigured')
    if (r.kind !== 'unconfigured') return
    expect(r.defaultPath).toMatch(/[\\/](\.bridgeai|bridgeai)[\\/]global-vault$/)
  })
})
