import { describe, test, expect } from 'bun:test'
import {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  forkSession,
} from '../../src/entrypoints/sdk.js'

describe('SDK session functions', () => {
  test('listSessions returns array', async () => {
    const sessions = await listSessions()
    expect(Array.isArray(sessions)).toBe(true)
  })

  test('listSessions with dir returns array', async () => {
    const sessions = await listSessions({ dir: process.cwd() })
    expect(Array.isArray(sessions)).toBe(true)
  })

  test('getSessionInfo returns undefined for non-existent session', async () => {
    const info = await getSessionInfo('00000000-0000-0000-0000-000000000000')
    expect(info).toBeUndefined()
  })

  test('getSessionMessages returns empty array for non-existent session', async () => {
    const messages = await getSessionMessages('00000000-0000-0000-0000-000000000000')
    expect(messages).toEqual([])
  })

  test('renameSession throws for non-existent session', async () => {
    await expect(renameSession('00000000-0000-0000-0000-000000000000', 'test'))
      .rejects.toThrow('Session not found')
  })

  test('forkSession throws for non-existent session', async () => {
    await expect(forkSession('00000000-0000-0000-0000-000000000000'))
      .rejects.toThrow('Session not found')
  })

  test('session ID validation rejects invalid UUID', async () => {
    await expect(getSessionInfo('not-a-uuid'))
      .rejects.toThrow('Invalid session ID')
  })
})
