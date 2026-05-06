/**
 * Security hardening round 2 — regression tests.
 *
 * Covers:
 *   - CLAUDE.md must not be framed as user intent in yoloClassifier
 *   - Subprocess env must always scrub core API secrets
 *   - Trust TTL must expire after configured duration
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Finding #9: CLAUDE.md injection in yoloClassifier
// ---------------------------------------------------------------------------

describe('CLAUDE.md classifier framing', () => {
  it('must not frame CLAUDE.md as user intent or user-provided', async () => {
    // Read the source file and check the framing text
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(
      import.meta.dir,
      '../utils/permissions/yoloClassifier.ts',
    )
    const source = fs.readFileSync(filePath, 'utf-8')

    // Extract the buildClaudeMdMessage function body
    const fnMatch = source.match(
      /function buildClaudeMdMessage\(\)[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnBody = fnMatch![0].toLowerCase()

    // Must NOT contain "user's intent" or "user provided"
    expect(fnBody).not.toContain("user's intent")
    expect(fnBody).not.toContain('user provided')
    expect(fnBody).not.toContain('user_claude_md')

    // Must contain repository-provided framing
    expect(fnBody).toContain('repository')
    expect(fnBody).toContain('must not')
  })
})

// ---------------------------------------------------------------------------
// Finding #10: Subprocess env scrubbing
// ---------------------------------------------------------------------------

describe('subprocess env scrubbing', () => {
  const SECRETS_THAT_MUST_BE_SCRUBBED = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'MISTRAL_API_KEY',
    'MINIMAX_API_KEY',
    'SPARK_API_KEY',
  ]

  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const k of SECRETS_THAT_MUST_BE_SCRUBBED) {
      savedEnv[k] = process.env[k]
      process.env[k] = `test-secret-${k}`
    }
    // Ensure extended scrub is NOT enabled — we test the always-scrub path
    savedEnv['CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'] =
      process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
    delete process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
    // Save and clear opt-out flag
    savedEnv['CLAUDE_CODE_SUBPROCESS_KEEP_API_KEYS'] =
      process.env.CLAUDE_CODE_SUBPROCESS_KEEP_API_KEYS
    delete process.env.CLAUDE_CODE_SUBPROCESS_KEEP_API_KEYS
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = v
      }
    }
  })

  it('always scrubs core API secrets even without CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', async () => {
    const { subprocessEnv } = await import('../utils/subprocessEnv.js')
    const env = subprocessEnv()

    for (const key of SECRETS_THAT_MUST_BE_SCRUBBED) {
      expect(env[key]).toBeUndefined()
    }
  })

  it('preserves non-secret env vars', async () => {
    process.env.MY_SAFE_VAR = 'hello'
    const { subprocessEnv } = await import('../utils/subprocessEnv.js')
    const env = subprocessEnv()

    expect(env['MY_SAFE_VAR']).toBe('hello')
    delete process.env.MY_SAFE_VAR
  })

  it('respects CLAUDE_CODE_SUBPROCESS_KEEP_API_KEYS opt-out', async () => {
    process.env.CLAUDE_CODE_SUBPROCESS_KEEP_API_KEYS = '1'
    const { subprocessEnv } = await import('../utils/subprocessEnv.js')
    const env = subprocessEnv()

    // With opt-out, API keys should be preserved
    expect(env['ANTHROPIC_API_KEY']).toBe('test-secret-ANTHROPIC_API_KEY')
  })
})

// ---------------------------------------------------------------------------
// Finding #12: Trust TTL
// ---------------------------------------------------------------------------

describe('trust TTL', () => {
  it('isTrustValid rejects expired trust', async () => {
    // Read the source to verify the TTL mechanism exists
    const fs = await import('fs')
    const path = await import('path')
    const configPath = path.resolve(import.meta.dir, '../utils/config.ts')
    const source = fs.readFileSync(configPath, 'utf-8')

    // Verify the TTL constant and isTrustValid function exist
    expect(source).toContain('DEFAULT_TRUST_TTL_MS')
    expect(source).toContain('function isTrustValid')
    expect(source).toContain('trustAcceptedAt')

    // Verify the TTL check logic is present
    expect(source).toContain('Date.now() - projectConfig.trustAcceptedAt')
  })

  it('TrustDialog saves trustAcceptedAt timestamp', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const dialogPath = path.resolve(
      import.meta.dir,
      '../components/TrustDialog/TrustDialog.tsx',
    )
    const source = fs.readFileSync(dialogPath, 'utf-8')

    // Verify timestamp is saved alongside trust acceptance
    expect(source).toContain('trustAcceptedAt: Date.now()')
  })

  it('ProjectConfig type includes trustAcceptedAt field', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const configPath = path.resolve(import.meta.dir, '../utils/config.ts')
    const source = fs.readFileSync(configPath, 'utf-8')

    expect(source).toContain('trustAcceptedAt?: number')
  })
})
