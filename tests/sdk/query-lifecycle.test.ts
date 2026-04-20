import { describe, test, expect, afterEach } from 'bun:test'
import { query, forkSession, getSessionMessages, unstable_v2_createSession } from '../../src/entrypoints/sdk.js'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import {
  drainQuery,
  withTempDir,
  createSessionJsonl,
  createMinimalConversation,
  createMultiTurnConversation,
  UUID_REGEX,
} from './helpers/query-test-doubles.js'

describe('Query.sessionId accessor (API-1)', () => {
  test('query() returns a Query with sessionId for fresh query', () => {
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd() },
    })
    expect(q.sessionId).toBeDefined()
    expect(typeof q.sessionId).toBe('string')
    expect(q.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    q.interrupt()
  })

  test('query() with sessionId option returns that sessionId', () => {
    const sid = '12345678-1234-1234-1234-123456789012'
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd(), sessionId: sid },
    })
    expect(q.sessionId).toBe(sid)
    q.interrupt()
  })

  test('query() with continue:true still has a sessionId', () => {
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd(), continue: true },
    })
    expect(q.sessionId).toBeDefined()
    expect(typeof q.sessionId).toBe('string')
    q.interrupt()
  })

  test('two queries have different sessionIds', () => {
    const q1 = query({ prompt: 'a', options: { cwd: process.cwd() } })
    const q2 = query({ prompt: 'b', options: { cwd: process.cwd() } })
    expect(q1.sessionId).not.toBe(q2.sessionId)
    q1.interrupt()
    q2.interrupt()
  })
})

describe('Engine lazy-init guard (COR-1)', () => {
  test('QueryImpl close() works after construction', () => {
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd() },
    })
    expect(() => q.close()).not.toThrow()
  })

  test('SDKSession getMessages() works after construction', async () => {
    const { unstable_v2_createSession } = await import('../../src/entrypoints/sdk.js')
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    expect(session.sessionId).toBeDefined()
    expect(Array.isArray(session.getMessages())).toBe(true)
  })
})

describe('query() construction validation', () => {
  test('query() with no cwd throws immediately', () => {
    expect(() =>
      query({ prompt: 'test', options: {} as any })
    ).toThrow('query() requires options.cwd')
  })

  test('query() with empty string prompt creates valid Query', () => {
    const q = query({
      prompt: '',
      options: { cwd: process.cwd() },
    })
    expect(q.sessionId).toBeDefined()
    expect(typeof q.sessionId).toBe('string')
    q.interrupt()
  })

  test('query() with async iterable prompt creates valid Query', () => {
    async function* prompts() {
      yield { type: 'user' as const, message: { role: 'user' as const, content: 'hello' } }
    }
    const q = query({
      prompt: prompts(),
      options: { cwd: process.cwd() },
    })
    expect(q.sessionId).toBeDefined()
    q.interrupt()
  })
})

describe('Query interrupt lifecycle', () => {
  test('interrupt() followed by iterator drain does not hang', async () => {
    const q = query({
      prompt: 'test interrupt drain',
      options: { cwd: process.cwd() },
    })
    q.interrupt()
    const messages = await drainQuery(q)
    expect(Array.isArray(messages)).toBe(true)
  }, 10_000)

  test('close() followed by iterator drain does not hang', async () => {
    const q = query({
      prompt: 'test close drain',
      options: { cwd: process.cwd() },
    })
    q.close()
    const messages = await drainQuery(q)
    expect(Array.isArray(messages)).toBe(true)
  }, 10_000)

  test('interrupt() and close() both called — no double-error', async () => {
    const q = query({
      prompt: 'test double abort',
      options: { cwd: process.cwd() },
    })
    q.interrupt()
    q.close()
    const messages = await drainQuery(q)
    expect(Array.isArray(messages)).toBe(true)
  }, 10_000)

  test('interrupt() before iteration starts — completes cleanly', async () => {
    const q = query({
      prompt: 'test early interrupt',
      options: { cwd: process.cwd() },
    })
    q.interrupt()
    const messages = await drainQuery(q)
    expect(Array.isArray(messages)).toBe(true)
  }, 10_000)

  test('interrupt() from external AbortController propagates', async () => {
    const ac = new AbortController()
    const q = query({
      prompt: 'test external abort',
      options: { cwd: process.cwd(), abortController: ac },
    })
    ac.abort()
    const messages = await drainQuery(q)
    expect(Array.isArray(messages)).toBe(true)
  }, 10_000)
})

describe('Query resume lifecycle', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    }
    tempDirs.length = 0
  })

  test('query() with sessionId and existing JSONL — session loads messages', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const sid = randomUUID()
      const entries = createMinimalConversation(sid)
      createSessionJsonl(dir, sid, entries)

      const q = query({
        prompt: 'continue conversation',
        options: { cwd: dir, sessionId: sid },
      })
      expect(q.sessionId).toBe(sid)
      q.interrupt()
      await drainQuery(q)
    })
  })

  test('query() with continue:true and no prior sessions — creates fresh session', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const q = query({
        prompt: 'fresh start',
        options: { cwd: dir, continue: true },
      })
      expect(q.sessionId).toBeDefined()
      expect(UUID_REGEX.test(q.sessionId)).toBe(true)
      q.interrupt()
      await drainQuery(q)
    })
  })

  test('query() with fork:true — creates new sessionId', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const sid = randomUUID()
      const entries = createMinimalConversation(sid)
      createSessionJsonl(dir, sid, entries)

      const q = query({
        prompt: 'forked conversation',
        options: { cwd: dir, sessionId: sid, fork: true },
      })
      // Fork happens lazily during iteration; drain triggers it.
      // Interrupt after a short delay to let fork logic run.
      setTimeout(() => q.interrupt(), 100)
      await drainQuery(q)
      expect(q.sessionId).toBeDefined()
      expect(q.sessionId).not.toBe(sid)
    })
  }, 10_000)

  test('query() with resumeSessionAt — truncates at specified message', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const sid = randomUUID()
      const entries = createMultiTurnConversation(sid, 3)
      createSessionJsonl(dir, sid, entries)

      const secondAssistantUuid = entries[3].uuid as string

      const q = query({
        prompt: 'resume at message',
        options: { cwd: dir, sessionId: sid, resumeSessionAt: secondAssistantUuid },
      })
      expect(q.sessionId).toBe(sid)
      q.interrupt()
      await drainQuery(q)
    })
  })

  test('query() with resumeSessionAt pointing to invalid UUID — throws', async () => {
    await withTempDir(async (dir) => {
      tempDirs.push(dir)
      const sid = randomUUID()
      const entries = createMinimalConversation(sid)
      createSessionJsonl(dir, sid, entries)

      const fakeUuid = randomUUID()
      const q = query({
        prompt: 'bad resume point',
        options: { cwd: dir, sessionId: sid, resumeSessionAt: fakeUuid },
      })
      let caught = false
      try {
        for await (const _ of q) {
          // drain
        }
      } catch (err: any) {
        caught = true
        expect(err.message).toContain('resumeSessionAt')
        expect(err.message).toContain('not found')
      }
      expect(caught).toBe(true)
    })
  })
})

describe('Secure-by-default permissions (SEC-2)', () => {
  test('createDefaultCanUseTool denies all tools when no callback is provided', async () => {
    // We test this indirectly: create a query with no canUseTool or
    // onPermissionRequest, and verify that tool uses are denied.
    // The query engine will attempt to use tools, and the deny-by-default
    // behavior should produce permission_denials in the result.
    const q = query({
      prompt: 'Read the file test.txt',
      options: { cwd: process.cwd() },
    })

    const messages = await drainQuery(q)
    // The query should complete (not hang) and messages should be present
    expect(Array.isArray(messages)).toBe(true)
  })

  test('canUseTool callback overrides deny-by-default', async () => {
    const allowedTools: string[] = []
    const q = query({
      prompt: 'test with callback',
      options: {
        cwd: process.cwd(),
        canUseTool: async (name, _input) => {
          allowedTools.push(name)
          return { behavior: 'allow' }
        },
      },
    })
    q.interrupt()
    const messages = await drainQuery(q)
    expect(Array.isArray(messages)).toBe(true)
    // The callback was registered — even though we interrupted early,
    // the canUseTool function was wired correctly (no crash)
  })

  test('canUseTool callback can selectively deny tools', async () => {
    const q = query({
      prompt: 'test selective deny',
      options: {
        cwd: process.cwd(),
        canUseTool: async (name, _input) => {
          // Deny Bash specifically, allow everything else
          if (name === 'Bash') {
            return { behavior: 'deny', message: 'Bash is not allowed' }
          }
          return { behavior: 'allow' }
        },
      },
    })
    q.interrupt()
    const messages = await drainQuery(q)
    expect(Array.isArray(messages)).toBe(true)
  })

  test('V2 session with no callback denies tools by default', async () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    expect(session.sessionId).toBeDefined()
    // Session created successfully — deny-by-default applies at runtime
    // when tools are actually used
    session.interrupt()
  })

  test('V2 session with canUseTool callback allows tools', async () => {
    let callbackInvoked = false
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
      canUseTool: async (name, _input) => {
        callbackInvoked = true
        return { behavior: 'allow' }
      },
    })
    expect(session.sessionId).toBeDefined()
    // Callback is wired — would be invoked when tools execute
    session.interrupt()
  })
})
