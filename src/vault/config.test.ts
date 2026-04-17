import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  resolveVaultPath,
  resolveVaultConfig,
  loadVaultManifest,
  saveVaultManifest,
  isRepoOnboarded,
  adaptLegacyConfig,
} from './config.js'
import type { VaultManifest, VaultConfig, LegacyVaultConfig } from './types.js'

let tempDir: string
let savedEnv: string | undefined

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'vault-test-'))
  savedEnv = process.env.BRIDGEAI_VAULT_PATH
  delete process.env.BRIDGEAI_VAULT_PATH
})

afterEach(() => {
  if (savedEnv !== undefined) {
    process.env.BRIDGEAI_VAULT_PATH = savedEnv
  } else {
    delete process.env.BRIDGEAI_VAULT_PATH
  }
  rmSync(tempDir, { recursive: true, force: true })
})

describe('resolveVaultPath', () => {
  test('returns default path when no overrides exist', () => {
    const result = resolveVaultPath(tempDir)
    expect(result).toBe(join(tempDir, '.bridgeai', 'vault'))
  })

  test('respects BRIDGEAI_VAULT_PATH env var', () => {
    const custom = '/tmp/custom-vault'
    process.env.BRIDGEAI_VAULT_PATH = custom
    expect(resolveVaultPath(tempDir)).toBe(custom)
  })

  test('respects .bridgeai/config.json vaultPath', () => {
    const configDir = join(tempDir, '.bridgeai')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ vaultPath: '/opt/my-vault' }),
    )
    expect(resolveVaultPath(tempDir)).toBe('/opt/my-vault')
  })

  test('env var takes precedence over config.json', () => {
    const configDir = join(tempDir, '.bridgeai')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ vaultPath: '/opt/my-vault' }),
    )
    process.env.BRIDGEAI_VAULT_PATH = '/env/vault'
    expect(resolveVaultPath(tempDir)).toBe('/env/vault')
  })

  test('falls through on malformed config.json', () => {
    const configDir = join(tempDir, '.bridgeai')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), '{ broken json')
    expect(resolveVaultPath(tempDir)).toBe(
      join(tempDir, '.bridgeai', 'vault'),
    )
  })
})

describe('resolveVaultConfig', () => {
  test('returns full config with defaults', () => {
    const config = resolveVaultConfig(tempDir)
    expect(config.vaultPath).toBe(join(tempDir, '.bridgeai', 'vault'))
    expect(config.provider).toBe('generic')
    expect(config.projectRoot).toBe(tempDir)
    expect(config.projectName).toBeTruthy()
  })

  test('accepts explicit provider', () => {
    const config = resolveVaultConfig(tempDir, 'claude')
    expect(config.provider).toBe('claude')
  })

  test('populates both local.path and the deprecated vaultPath alias', () => {
    const config = resolveVaultConfig(tempDir)
    expect(config.local.path).toBe(config.vaultPath)
    expect(config.global).toBeNull()
  })
})

describe('adaptLegacyConfig', () => {
  test('coerces a legacy single-vault shape into the two-vault shape with global=null', () => {
    const legacy: LegacyVaultConfig = {
      vaultPath: '/tmp/legacy-vault',
      provider: 'claude',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
    }
    const out = adaptLegacyConfig(legacy)
    expect(out.local).toEqual({ path: '/tmp/legacy-vault' })
    expect(out.global).toBeNull()
    expect(out.vaultPath).toBe('/tmp/legacy-vault')
    expect(out.provider).toBe('claude')
    expect(out.projectName).toBe('demo')
    expect(out.projectRoot).toBe('/tmp/demo')
  })

  test('is idempotent on the new VaultConfig shape (returns input)', () => {
    const cfg: VaultConfig = {
      local: { path: '/tmp/L' },
      global: { path: '/tmp/G' },
      vaultPath: '/tmp/L',
      provider: 'generic',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
    }
    const out = adaptLegacyConfig(cfg)
    expect(out).toBe(cfg)
  })

  test('detects shape via presence of the local field, not via vaultPath', () => {
    // Even with vaultPath populated (deprecated alias), if local is present we treat as new shape.
    const cfg: VaultConfig = {
      local: { path: '/tmp/L' },
      global: null,
      vaultPath: '/tmp/L',
      provider: 'generic',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
    }
    const out = adaptLegacyConfig(cfg)
    expect(out).toBe(cfg)
  })
})

describe('manifest load/save round-trip', () => {
  test('loadVaultManifest returns null for non-existent vault', () => {
    expect(loadVaultManifest(join(tempDir, 'nope'))).toBeNull()
  })

  test('saveVaultManifest then loadVaultManifest round-trips', () => {
    const vaultPath = join(tempDir, '.bridgeai', 'vault')
    const manifest: VaultManifest = {
      createdAt: '2026-04-12T00:00:00Z',
      updatedAt: '2026-04-12T00:00:00Z',
      provider: 'claude',
      docs: ['CLAUDE.md', 'context.md'],
    }
    saveVaultManifest(vaultPath, manifest)
    const loaded = loadVaultManifest(vaultPath)
    expect(loaded).toEqual(manifest)
  })
})

describe('isRepoOnboarded', () => {
  test('returns false when no vault exists', () => {
    expect(isRepoOnboarded(tempDir)).toBe(false)
  })

  test('returns true when manifest.json exists', () => {
    const vaultPath = join(tempDir, '.bridgeai', 'vault')
    saveVaultManifest(vaultPath, {
      createdAt: '2026-04-12T00:00:00Z',
      updatedAt: '2026-04-12T00:00:00Z',
      provider: 'generic',
      docs: [],
    })
    expect(isRepoOnboarded(tempDir)).toBe(true)
  })
})
