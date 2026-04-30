import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  runWithSdkContext,
  getSessionId,
  regenerateSessionId,
  switchSession,
  getSessionProjectDir,
  getCwdState,
  setCwdState,
  getOriginalCwd,
  setOriginalCwd,
} from '../../src/bootstrap/state.js'
import type { SessionId } from '../../src/entrypoints/agentSdkTypes.js'

// Snapshot global state before each test so we can restore it
let originalSessionId: SessionId
let originalCwd: string
let originalOriginalCwd: string
let originalSessionProjectDir: string | null

describe('SDK context isolation', () => {
  beforeEach(() => {
    originalSessionId = getSessionId()
    originalCwd = getCwdState()
    originalOriginalCwd = getOriginalCwd()
    originalSessionProjectDir = getSessionProjectDir()
  })

  afterEach(() => {
    // Restore global state after each test
    switchSession(originalSessionId, originalSessionProjectDir)
    setCwdState(originalCwd)
    setOriginalCwd(originalOriginalCwd)
  })

  describe('setCwdState', () => {
    test('writes to global STATE outside of SDK context', () => {
      setCwdState('/global/path')
      expect(getCwdState()).toBe('/global/path')
    })

    test('writes to SDK context inside runWithSdkContext', () => {
      const ctx = {
        sessionId: 'test-session-1' as SessionId,
        sessionProjectDir: null,
        cwd: '/initial',
        originalCwd: '/initial',
      }

      runWithSdkContext(ctx, () => {
        setCwdState('/sdk/path')
        // Context-aware getter should read from context
        expect(getCwdState()).toBe('/sdk/path')
      })

      // Global state should be unchanged
      expect(getCwdState()).toBe(originalCwd)
    })

    test('does not leak between concurrent contexts', async () => {
      const ctxA = {
        sessionId: 'session-a' as SessionId,
        sessionProjectDir: null,
        cwd: '/a',
        originalCwd: '/a',
      }
      const ctxB = {
        sessionId: 'session-b' as SessionId,
        sessionProjectDir: null,
        cwd: '/b',
        originalCwd: '/b',
      }

      const results = await Promise.all([
        new Promise<string>(resolve => {
          runWithSdkContext(ctxA, async () => {
            setCwdState('/a/modified')
            // Small delay to allow interleaving
            await Bun.sleep(1)
            resolve(getCwdState())
          })
        }),
        new Promise<string>(resolve => {
          runWithSdkContext(ctxB, async () => {
            await Bun.sleep(1)
            setCwdState('/b/modified')
            resolve(getCwdState())
          })
        }),
      ])

      expect(results[0]).toBe('/a/modified')
      expect(results[1]).toBe('/b/modified')
    })
  })

  describe('setOriginalCwd', () => {
    test('writes to global STATE outside of SDK context', () => {
      setOriginalCwd('/global/original')
      expect(getOriginalCwd()).toBe('/global/original')
    })

    test('writes to SDK context inside runWithSdkContext', () => {
      const ctx = {
        sessionId: 'test-session-2' as SessionId,
        sessionProjectDir: null,
        cwd: '/cwd',
        originalCwd: '/initial',
      }

      runWithSdkContext(ctx, () => {
        setOriginalCwd('/sdk/original')
        expect(getOriginalCwd()).toBe('/sdk/original')
      })

      // Global state should be unchanged
      expect(getOriginalCwd()).toBe(originalOriginalCwd)
    })
  })

  describe('regenerateSessionId', () => {
    test('updates global STATE outside of SDK context', () => {
      const beforeId = getSessionId()
      const newId = regenerateSessionId()
      expect(newId).not.toBe(beforeId)
      expect(getSessionId()).toBe(newId)
    })

    test('updates SDK context inside runWithSdkContext', () => {
      const ctx = {
        sessionId: 'ctx-session-before' as SessionId,
        sessionProjectDir: '/some/dir',
        cwd: '/cwd',
        originalCwd: '/cwd',
      }

      let newId: SessionId
      runWithSdkContext(ctx, () => {
        newId = regenerateSessionId()
        expect(getSessionId()).toBe(newId)
        // sessionProjectDir should be reset to null
        expect(getSessionProjectDir()).toBeNull()
      })

      // Global state should be unchanged
      expect(getSessionId()).toBe(originalSessionId)
    })
  })

  describe('switchSession', () => {
    test('updates global STATE outside of SDK context', () => {
      const newSessionId = 'switched-global' as SessionId
      switchSession(newSessionId, '/global/project')
      expect(getSessionId()).toBe(newSessionId)
      expect(getSessionProjectDir()).toBe('/global/project')
    })

    test('updates SDK context inside runWithSdkContext', () => {
      const ctx = {
        sessionId: 'before-switch' as SessionId,
        sessionProjectDir: null,
        cwd: '/cwd',
        originalCwd: '/cwd',
      }

      runWithSdkContext(ctx, () => {
        switchSession('after-switch' as SessionId, '/sdk/project')
        expect(getSessionId()).toBe('after-switch')
        expect(getSessionProjectDir()).toBe('/sdk/project')
      })

      // Global state should be unchanged
      expect(getSessionId()).toBe(originalSessionId)
      expect(getSessionProjectDir()).toBe(originalSessionProjectDir)
    })
  })

  describe('end-to-end: parallel sessions', () => {
    test('independent sessions do not interfere with each other', async () => {
      const ctx1 = {
        sessionId: 'parallel-1' as SessionId,
        sessionProjectDir: null,
        cwd: '/session1',
        originalCwd: '/session1',
      }
      const ctx2 = {
        sessionId: 'parallel-2' as SessionId,
        sessionProjectDir: null,
        cwd: '/session2',
        originalCwd: '/session2',
      }

      const [result1, result2] = await Promise.all([
        new Promise<{ sessionId: string; cwd: string }>(resolve => {
          runWithSdkContext(ctx1, async () => {
            setCwdState('/session1/new-cwd')
            const newId = regenerateSessionId()
            await Bun.sleep(1)
            resolve({ sessionId: getSessionId(), cwd: getCwdState() })
            // Assign to suppress unused-var lint
            void newId
          })
        }),
        new Promise<{ sessionId: string; cwd: string }>(resolve => {
          runWithSdkContext(ctx2, async () => {
            await Bun.sleep(1)
            switchSession('parallel-2-switched' as SessionId)
            setCwdState('/session2/new-cwd')
            resolve({ sessionId: getSessionId(), cwd: getCwdState() })
          })
        }),
      ])

      // Session 1 should see its own state
      expect(result1.cwd).toBe('/session1/new-cwd')
      // Session 2 should see its own state
      expect(result2.sessionId).toBe('parallel-2-switched')
      expect(result2.cwd).toBe('/session2/new-cwd')

      // Global state should be untouched
      expect(getSessionId()).toBe(originalSessionId)
      expect(getCwdState()).toBe(originalCwd)
    })
  })
})
