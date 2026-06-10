import { describe, expect, it, beforeEach } from 'bun:test'
import { createConversationCache, type Message } from './conversationCache.js'

describe('conversationCache', () => {
  let cache: ReturnType<typeof createConversationCache>

  beforeEach(() => {
    cache = createConversationCache({ maxSize: 3, ttlMs: 60000 })
  })

  describe('basic operations', () => {
    it('stores and retrieves messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'hello' },
      ]
      cache.set('session1', messages)
      expect(cache.get('session1')).toEqual(messages)
    })

    it('returns undefined for missing key', () => {
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('reports correct size', () => {
      cache.set('a', [{ role: 'user', content: 'a' }])
      cache.set('b', [{ role: 'user', content: 'b' }])
      expect(cache.size).toBe(2)
    })
  })

  describe('LRU eviction', () => {
    it('evicts oldest when at capacity', () => {
      cache.set('a', [{ role: 'user', content: 'a' }])
      cache.set('b', [{ role: 'user', content: 'b' }])
      cache.set('c', [{ role: 'user', content: 'c' }])
      cache.set('d', [{ role: 'user', content: 'd' }]) // should evict 'a'
      
      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('d')).toBeDefined()
    })

    it('updates access order on get', () => {
      cache.set('a', [{ role: 'user', content: 'a' }])
      cache.set('b', [{ role: 'user', content: 'b' }])
      cache.get('a') // access 'a' to update order
      cache.set('c', [{ role: 'user', content: 'c' }])
      cache.set('d', [{ role: 'user', content: 'd' }]) // should evict 'b'
      
      expect(cache.get('b')).toBeUndefined()
      expect(cache.get('a')).toBeDefined()
    })
  })

  describe('TTL expiration', () => {
    it('evicts expired entries', async () => {
      const shortCache = createConversationCache({ ttlMs: 1 })
      shortCache.set('x', [{ role: 'user', content: 'x' }])
      
      await new Promise(r => setTimeout(r, 10))
      
      expect(shortCache.get('x')).toBeUndefined()
    })
  })

  describe('delete and clear', () => {
    it('deletes specific key', () => {
      cache.set('a', [{ role: 'user', content: 'a' }])
      expect(cache.delete('a')).toBe(true)
      expect(cache.get('a')).toBeUndefined()
    })

    it('clears all entries', () => {
      cache.set('a', [{ role: 'user', content: 'a' }])
      cache.set('b', [{ role: 'user', content: 'b' }])
      cache.clear()
      expect(cache.size).toBe(0)
    })
  })
})