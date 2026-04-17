import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadMachineConfig,
  saveMachineConfig,
  resolveMachineConfigPath,
} from './globalConfig.js'

let savedEnv: string | undefined
let tmpHome: string

beforeEach(() => {
  savedEnv = process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  tmpHome = mkdtempSync(join(tmpdir(), 'pifb-machinecfg-'))
  process.env.BRIDGEAI_MACHINE_CONFIG_PATH = join(tmpHome, 'config.json')
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  else process.env.BRIDGEAI_MACHINE_CONFIG_PATH = savedEnv
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
