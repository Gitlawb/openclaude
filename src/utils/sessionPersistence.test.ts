import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
} from './sessionPersistence.js'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'

describe('sessionPersistence', () => {
  const testSessionDir = join(process.env.OPENCLAUDE_DIR ?? '.', '.openclaude', 'sessions')
  
  beforeEach(async () => {
    // Clean up any existing test sessions
    try {
      const sessions = await listSessions()
      for (const s of sessions) {
        if (s.id.startsWith('test-')) {
          await deleteSession(s.id)
        }
      }
    } catch {}
  })

  describe('createSession', () => {
    it('creates session with generated ID', () => {
      const session = createSession([], { model: 'gpt-4' })
      expect(session.id).toBeTruthy()
      expect(session.createdAt).toBeGreaterThan(0)
      expect(session.config.model).toBe('gpt-4')
    })

    it('creates session with empty messages', () => {
      const session = createSession()
      expect(session.messages).toEqual([])
    })
  })

  describe('saveSession and loadSession', () => {
    it('saves and loads session', async () => {
      const session = createSession(
        [{ role: 'user', content: 'hello', timestamp: Date.now() }],
        { model: 'gpt-4' },
      )
      session.id = 'test-session-1'
      
      await saveSession(session)
      const loaded = await loadSession('test-session-1')
      
      expect(loaded).not.toBeNull()
      expect(loaded?.id).toBe('test-session-1')
      expect(loaded?.messages.length).toBe(1)
      expect(loaded?.config.model).toBe('gpt-4')
    })

    it('returns null for nonexistent session', async () => {
      const result = await loadSession('nonexistent-session')
      expect(result).toBeNull()
    })
  })

  describe('listSessions', () => {
    it('returns array of sessions', async () => {
      const sessions = await listSessions()
      expect(Array.isArray(sessions)).toBe(true)
    })
  })

  describe('deleteSession', () => {
    it('deletes existing session', async () => {
      const session = createSession([], {})
      session.id = 'test-delete-me'
      
      await saveSession(session)
      const deleted = await deleteSession('test-delete-me')
      
      expect(deleted).toBe(true)
      expect(await loadSession('test-delete-me')).toBeNull()
    })

    it('returns false for nonexistent session', async () => {
      const result = await deleteSession('nonexistent')
      expect(result).toBe(false)
    })
  })
})