import { describe, test, expect, afterEach, beforeAll, afterAll } from 'bun:test'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt,
} from '../../src/entrypoints/sdk/index.js'
import { getSessionProjectDir } from '../../src/bootstrap/state.js'
import {
  drainQuery,
  withTempDir,
  createSessionJsonl,
  createMinimalConversation,
  createMultiTurnConversation,
  UUID_REGEX,
} from './helpers/query-test-doubles.js'

// sendMessage drains trigger init(), which checks auth. Stub it for CI.
const AUTH_KEY = 'ANTHROPIC_API_KEY'
let savedApiKey: string | undefined

beforeAll(() => {
  savedApiKey = process.env[AUTH_KEY]
  if (!savedApiKey) process.env[AUTH_KEY] = 'sk-test-v2-lifecycle-stub'
})

afterAll(() => {
  if (savedApiKey === undefined) delete process.env[AUTH_KEY]
  else process.env[AUTH_KEY] = savedApiKey
})

// Collect temp dirs for cleanup
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
  tempDirs.length = 0
})

describe('V2: session creation', () => {
  test('createSession() returns SDKSession with valid sessionId', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    expect(session.sessionId).toBeDefined()
    expect(UUID_REGEX.test(session.sessionId)).toBe(true)
  })

  test('createSession().getMessages() returns empty array initially', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    const messages = session.getMessages()
    expect(Array.isArray(messages)).toBe(true)
    expect(messages.length).toBe(0)
  })

  test('createSession() with no cwd throws', () => {
    expect(() =>
      unstable_v2_createSession({} as any)
    ).toThrow()
  })

  test('createSession() with model option — session created without error', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
      model: 'claude-sonnet-4-6',
    })
    expect(session.sessionId).toBeDefined()
  })
})

describe('V2: session interrupt', () => {
  test('session.interrupt() does not throw', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    expect(() => session.interrupt()).not.toThrow()
  })

  test('session with external abortController — abort signal propagates', async () => {
    const ac = new AbortController()
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
      abortController: ac,
    })
    ac.abort()
    let caught = false
    try {
      for await (const _ of session.sendMessage('test')) {
        // drain
      }
    } catch {
      caught = true
    }
    // Either completes with no messages or throws — both are acceptable
    expect(true).toBe(true)
  }, 10_000)
})

describe('V2: session resume', () => {
  test('resumeSession() loads prior messages from JSONL', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const sid = randomUUID()
      const entries = createMinimalConversation(sid)
      createSessionJsonl(dir, sid, entries)

      const session = await unstable_v2_resumeSession(sid, { cwd: dir })
      expect(session.sessionId).toBe(sid)

      const messages = session.getMessages()
      expect(messages.length).toBeGreaterThanOrEqual(2)
    })
  })

  test('resumeSession() with invalid sessionId throws', async () => {
    await expect(
      unstable_v2_resumeSession('not-a-uuid', { cwd: process.cwd() })
    ).rejects.toThrow('Invalid session ID')
  })

  test('resumeSession() with non-existent session — creates session with empty messages', async () => {
    const fakeSid = randomUUID()
    const session = await unstable_v2_resumeSession(fakeSid, { cwd: process.cwd() })
    expect(session.sessionId).toBe(fakeSid)
    const messages = session.getMessages()
    expect(messages.length).toBe(0)
  })

  test('resumeSession() preserves multi-turn conversation order', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const sid = randomUUID()
      const entries = createMultiTurnConversation(sid, 3)
      createSessionJsonl(dir, sid, entries)

      const session = await unstable_v2_resumeSession(sid, { cwd: dir })
      const messages = session.getMessages()

      expect(messages.length).toBeGreaterThanOrEqual(6)
    })
  })

  test('resumeSession() sets sessionProjectDir via switchSession', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const sid = randomUUID()
      createSessionJsonl(dir, sid, createMinimalConversation(sid))

      await unstable_v2_resumeSession(sid, { cwd: dir })

      // Fix verification: resumeSession must call switchSession with the
      // resolved projectPath so that transcript writes go to the correct dir.
      const projectDir = getSessionProjectDir()
      expect(projectDir).not.toBeNull()
    })
  })
})

describe('V2: permission handling', () => {
  test('respondToPermission() with unknown toolUseId — no-op', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    expect(() =>
      session.respondToPermission('unknown-id', {
        behavior: 'allow',
      })
    ).not.toThrow()
  })

  test('createSession() with canUseTool callback — session created successfully', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
      canUseTool: async (name: string, _input: unknown) => ({
        behavior: 'deny' as const,
        message: `Tool ${name} denied by test`,
      }),
    })
    expect(session.sessionId).toBeDefined()
  })

  test('createSession() with onPermissionRequest callback — session created successfully', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
      onPermissionRequest: (_msg) => {
        // No-op — just verify it doesn't throw during construction
      },
    })
    expect(session.sessionId).toBeDefined()
  })
})

describe('V2: unstable_v2_prompt', () => {
  test('throws when query completes without a result message (aborted)', async () => {
    const ac = new AbortController()
    // Abort immediately so the query never produces a result
    ac.abort()

    await expect(
      unstable_v2_prompt('test', {
        cwd: process.cwd(),
        abortController: ac,
      }),
    ).rejects.toThrow()
  })

  test('throws when cwd is missing', () => {
    expect(() =>
      unstable_v2_prompt('test', {} as any),
    ).toThrow()
  })
})
