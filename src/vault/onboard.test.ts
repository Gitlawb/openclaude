import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runOnboarding, cleanupPartialVault, isRepoOnboarded } from './onboard.js'

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
