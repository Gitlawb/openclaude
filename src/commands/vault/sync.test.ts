import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let savedMachineEnv: string | undefined
let savedGlobalEnv: string | undefined
let tmpRoot: string
let savedCwd: string

function gitOk(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, stdio: 'pipe' })
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: ${r.stderr?.toString() ?? ''}`,
    )
  }
}

function setupCwdRepo(): string {
  // The sync command resolves cfg via getOriginalCwd(); we chdir into a
  // throwaway repo so resolveVaultConfig finds something.
  const repoRoot = join(tmpRoot, 'cwd-repo')
  mkdirSync(repoRoot, { recursive: true })
  mkdirSync(join(repoRoot, '.git'), { recursive: true }) // placeholder to look like a git repo
  return repoRoot
}

beforeEach(() => {
  savedMachineEnv = process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  savedGlobalEnv = process.env.BRIDGEAI_GLOBAL_VAULT
  savedCwd = process.cwd()
  tmpRoot = mkdtempSync(join(tmpdir(), 'pifb-sync-'))
  process.env.BRIDGEAI_MACHINE_CONFIG_PATH = join(tmpRoot, 'machine-config.json')
  delete process.env.BRIDGEAI_GLOBAL_VAULT
  process.chdir(setupCwdRepo())
})

afterEach(() => {
  process.chdir(savedCwd)
  if (savedMachineEnv === undefined) delete process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  else process.env.BRIDGEAI_MACHINE_CONFIG_PATH = savedMachineEnv
  if (savedGlobalEnv === undefined) delete process.env.BRIDGEAI_GLOBAL_VAULT
  else process.env.BRIDGEAI_GLOBAL_VAULT = savedGlobalEnv
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('bridgeai vault sync', () => {
  test('no global vault configured → exit 1 with documented message', async () => {
    // Default: no env, no machine config → cfg.global is null.
    const mod = await import('./sync.js')
    const { call } = await mod.default.load()
    const result = await call('', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('No global vault configured')
    expect(process.exitCode).toBe(1)
    process.exitCode = 0 // reset for next test
  })

  test('global vault path has no .git → exit 1 with not-a-git-repo message', async () => {
    const fakeGlobal = join(tmpRoot, 'not-a-repo')
    mkdirSync(fakeGlobal, { recursive: true })
    process.env.BRIDGEAI_GLOBAL_VAULT = fakeGlobal

    const mod = await import('./sync.js')
    const { call } = await mod.default.load()
    const result = await call('', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('is not a git repo')
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  test('global vault is a git repo but has no remote → actionable D-1 message', async () => {
    const globalPath = join(tmpRoot, 'global-vault-no-remote')
    mkdirSync(globalPath, { recursive: true })
    gitOk(globalPath, ['init', '-q'])
    process.env.BRIDGEAI_GLOBAL_VAULT = globalPath

    const mod = await import('./sync.js')
    const { call } = await mod.default.load()
    const result = await call('', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('No git remote configured')
    expect(result.value).toContain('git remote add origin')
    expect(result.value).toContain('bridgeai vault sync')
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  test('happy path: pull (no-op) + push succeeds against a bare-repo remote', async () => {
    // Set up a bare repo as the "remote" + a clone as the global vault.
    const remotePath = join(tmpRoot, 'remote.git')
    gitOk(tmpRoot, ['init', '--bare', '-q', remotePath])

    const globalPath = join(tmpRoot, 'global-vault')
    mkdirSync(globalPath, { recursive: true })
    gitOk(globalPath, ['init', '-q'])
    gitOk(globalPath, ['config', 'user.email', 'test@example.com'])
    gitOk(globalPath, ['config', 'user.name', 'Test'])
    writeFileSync(join(globalPath, 'README.md'), '# vault\n', 'utf-8')
    gitOk(globalPath, ['add', '.'])
    gitOk(globalPath, ['commit', '-q', '-m', 'init'])
    gitOk(globalPath, ['remote', 'add', 'origin', remotePath])
    gitOk(globalPath, ['push', '-u', '-q', 'origin', 'HEAD:main'])
    // Ensure local has main checked out and tracking origin/main.
    gitOk(globalPath, ['branch', '-M', 'main'])
    gitOk(globalPath, ['branch', '--set-upstream-to=origin/main', 'main'])

    process.env.BRIDGEAI_GLOBAL_VAULT = globalPath
    const mod = await import('./sync.js')
    const { call } = await mod.default.load()
    const result = await call('', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('Synced')
    expect(process.exitCode ?? 0).toBe(0)
  })
})
