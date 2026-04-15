import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
  existsSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runOnboarding, cleanupPartialVault, isRepoOnboarded } from './onboard.js'
import { detectVaultShape } from './scaffold.js'

let tempDir: string
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'onboard-test-'))
  // Save env vars that may affect detection
  savedEnv = {
    BRIDGEAI_VAULT_PATH: process.env.BRIDGEAI_VAULT_PATH,
    CURSOR_TRACE_ID: process.env.CURSOR_TRACE_ID,
    CURSOR_SESSION: process.env.CURSOR_SESSION,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
  }
  // Clear env vars for clean tests
  delete process.env.BRIDGEAI_VAULT_PATH
  delete process.env.CURSOR_TRACE_ID
  delete process.env.CURSOR_SESSION
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_AI_API_KEY
})

afterEach(() => {
  // Restore env vars
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value !== undefined) {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }
  rmSync(tempDir, { recursive: true, force: true })
})

describe('runOnboarding', () => {
  test('returns result with correct fields on a minimal project', async () => {
    // Create a minimal project with a package.json
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project', scripts: { test: 'bun test' } }),
    )
    mkdirSync(join(tempDir, 'src'), { recursive: true })
    writeFileSync(join(tempDir, 'src', 'index.ts'), 'export const hello = "world"')

    const result = await runOnboarding(tempDir)

    expect(result.vaultPath).toBe(join(tempDir, '.bridgeai', 'vault'))
    expect(result.provider).toBe('claude') // default when no env vars
    expect(Array.isArray(result.docsGenerated)).toBe(true)
    expect(result.docsGenerated.length).toBeGreaterThan(0)
    expect(result.providerFile).toBeDefined()
    expect(result.providerFile.filePath).toBeTruthy()
    expect(typeof result.isLargeRepo).toBe('boolean')
  })

  test('calls progress callback with expected messages', async () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
    )

    const messages: string[] = []
    await runOnboarding(tempDir, {
      onProgress: (msg) => messages.push(msg),
    })

    expect(messages.length).toBeGreaterThan(0)
    expect(messages.some(m => m.includes('Detected provider'))).toBe(true)
    expect(messages.some(m => m.includes('Scanning project structure'))).toBe(true)
    expect(messages.some(m => m.includes('Generating vault docs'))).toBe(true)
    expect(messages.some(m => m.includes('Generated'))).toBe(true)
    expect(messages.some(m => m.includes('config'))).toBe(true)
  })

  test('provider detection flows through to result', async () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
    )

    // Explicit provider
    const result = await runOnboarding(tempDir, { provider: 'cursor' })
    expect(result.provider).toBe('cursor')

    // Env-based detection (need CLAUDE_CODE_USE_GEMINI for API provider mapping)
    rmSync(join(tempDir, '.bridgeai'), { recursive: true, force: true })
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    const result2 = await runOnboarding(tempDir)
    expect(result2.provider).toBe('gemini')
    delete process.env.CLAUDE_CODE_USE_GEMINI
  })
})

describe('runOnboarding v2 scaffold integration', () => {
  // These tests exercise the scaffold step, which requires a git root.
  // We create a minimal `.git` directory so `findGitRoot` succeeds.
  function initGitStub(root: string): void {
    mkdirSync(join(root, '.git'), { recursive: true })
  }

  test('fresh repo → produces a v2-shaped vault', async () => {
    initGitStub(tempDir)
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'fresh-project' }),
    )

    const result = await runOnboarding(tempDir)

    // The v2 tree should exist after onboarding
    expect(detectVaultShape(result.vaultPath)).toBe('v2')
    expect(existsSync(join(result.vaultPath, '_conventions.md'))).toBe(true)
    expect(existsSync(join(result.vaultPath, '_index.md'))).toBe(true)
    expect(existsSync(join(result.vaultPath, 'knowledge', '_index.md'))).toBe(true)
    expect(existsSync(join(result.vaultPath, 'meta', 'templates'))).toBe(true)
  })

  test('pre-scaffolded v2 vault → scaffold is idempotent (no re-write)', async () => {
    initGitStub(tempDir)
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'v2-project' }),
    )

    // Pre-populate a v2 vault with a sentinel _conventions.md
    const vaultPath = join(tempDir, '.bridgeai', 'vault')
    mkdirSync(vaultPath, { recursive: true })
    const sentinel = '# Custom user conventions — DO NOT OVERWRITE\n'
    const conventionsPath = join(vaultPath, '_conventions.md')
    writeFileSync(conventionsPath, sentinel, 'utf-8')
    const mtimeBefore = statSync(conventionsPath).mtimeMs

    await runOnboarding(tempDir)

    // Sentinel survives byte-identically (scaffold is idempotent).
    expect(readFileSync(conventionsPath, 'utf-8')).toBe(sentinel)
    expect(detectVaultShape(vaultPath)).toBe('v2')
    // And mtime should be unchanged (not touched).
    const mtimeAfter = statSync(conventionsPath).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
  })

  test('v1 vault → does NOT auto-migrate; surfaces upgrade suggestion', async () => {
    initGitStub(tempDir)
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'v1-project' }),
    )

    // Pre-populate a v1 vault: has manifest.json, no _conventions.md
    const vaultPath = join(tempDir, '.bridgeai', 'vault')
    mkdirSync(vaultPath, { recursive: true })
    const manifest = { version: 1, provider: 'claude', createdAt: '2024-01-01' }
    const manifestPath = join(vaultPath, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8')

    const messages: string[] = []
    await runOnboarding(tempDir, {
      onProgress: (m) => messages.push(m),
    })

    // Scaffold did NOT run on top of v1: _conventions.md must not appear.
    expect(existsSync(join(vaultPath, '_conventions.md'))).toBe(false)
    // Shape remains v1 (manifest.json present, no _conventions.md).
    expect(detectVaultShape(vaultPath)).toBe('v1')
    // Upgrade suggestion surfaced on the progress channel.
    expect(
      messages.some((m) =>
        m.includes("Run 'bridgeai vault upgrade'"),
      ),
    ).toBe(true)
  })
})

describe('isRepoOnboarded', () => {
  test('returns false for fresh project', () => {
    expect(isRepoOnboarded(tempDir)).toBe(false)
  })

  test('returns true after onboarding', async () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
    )
    await runOnboarding(tempDir)
    expect(isRepoOnboarded(tempDir)).toBe(true)
  })
})

describe('cleanupPartialVault', () => {
  test('removes vault directory', async () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
    )
    await runOnboarding(tempDir)

    const vaultPath = join(tempDir, '.bridgeai', 'vault')
    expect(existsSync(vaultPath)).toBe(true)

    cleanupPartialVault(tempDir)
    expect(existsSync(vaultPath)).toBe(false)
  })

  test('does not throw when vault does not exist', () => {
    expect(() => cleanupPartialVault(tempDir)).not.toThrow()
  })
})
