import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapGlobalVault } from './globalBootstrap.js'
import { loadMachineConfig } from './globalConfig.js'

let savedConfigEnv: string | undefined
let tmpRoot: string

beforeEach(() => {
  savedConfigEnv = process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  tmpRoot = mkdtempSync(join(tmpdir(), 'pifb-bootstrap-'))
  process.env.BRIDGEAI_MACHINE_CONFIG_PATH = join(tmpRoot, 'machine-config.json')
})

afterEach(() => {
  if (savedConfigEnv === undefined) delete process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  else process.env.BRIDGEAI_MACHINE_CONFIG_PATH = savedConfigEnv
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('bootstrapGlobalVault', () => {
  test('empty target → git init runs, scaffold lands, machine config records path', async () => {
    const target = join(tmpRoot, 'global-vault')
    const result = await bootstrapGlobalVault(target)

    expect(result.initializedGit).toBe(true)
    expect(result.scaffoldedFromScratch).toBe(true)
    expect(result.path).toBe(target)

    expect(existsSync(join(target, '.git'))).toBe(true)
    expect(existsSync(join(target, '_index.md'))).toBe(true)
    expect(existsSync(join(target, '_conventions.md'))).toBe(true)
    expect(existsSync(join(target, '_log.md'))).toBe(true)

    expect(loadMachineConfig().globalVaultPath).toBe(target)
    expect(loadMachineConfig().declinedGlobalVault).toBe(false)

    const log = readFileSync(join(target, '_log.md'), 'utf-8')
    expect(log).toContain('global-vault-bootstrapped')
    expect(log).toContain('initializedGit=true')
    expect(log).toContain('source: code-analysis')
  })

  test('target already a git repo → skips git init, still scaffolds', async () => {
    const target = join(tmpRoot, 'pre-existing')
    mkdirSync(target, { recursive: true })
    spawnSync('git', ['init', '-q'], { cwd: target })
    expect(existsSync(join(target, '.git'))).toBe(true)

    const result = await bootstrapGlobalVault(target)

    expect(result.initializedGit).toBe(false)
    expect(result.scaffoldedFromScratch).toBe(false)
    expect(existsSync(join(target, '_index.md'))).toBe(true)
    expect(existsSync(join(target, '_conventions.md'))).toBe(true)

    const log = readFileSync(join(target, '_log.md'), 'utf-8')
    expect(log).toContain('initializedGit=false')
  })

  test('idempotent: second bootstrap on the same target leaves state consistent', async () => {
    const target = join(tmpRoot, 'global-vault-idem')

    const first = await bootstrapGlobalVault(target)
    expect(first.initializedGit).toBe(true)

    const indexBefore = readFileSync(join(target, '_index.md'), 'utf-8')

    const second = await bootstrapGlobalVault(target)
    expect(second.initializedGit).toBe(false) // .git already exists, skip init
    expect(second.scaffoldedFromScratch).toBe(false)

    // Existing _index.md not clobbered.
    const indexAfter = readFileSync(join(target, '_index.md'), 'utf-8')
    expect(indexAfter).toBe(indexBefore)

    // Machine config still has the path.
    expect(loadMachineConfig().globalVaultPath).toBe(target)

    // Log has 2 bootstrap entries.
    const log = readFileSync(join(target, '_log.md'), 'utf-8')
    expect(log.match(/global-vault-bootstrapped/g)?.length).toBe(2)
  })
})
