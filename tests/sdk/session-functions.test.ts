import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  forkSession,
} from '../../src/entrypoints/sdk/index.js'
import { readJSONLFile } from '../../src/utils/json.js'
import { getProjectDir } from '../../src/utils/sessionStoragePortable.js'

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

describe('forkSession metadata preservation (COR-2)', () => {
  const testProjectDir = join(tmpdir(), 'fork-metadata-test-' + process.pid)
  let sessionDir: string

  beforeEach(() => {
    sessionDir = getProjectDir(testProjectDir)
    mkdirSync(sessionDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true })
  })

  test('forked session preserves title and tag metadata', async () => {
    const sourceId = randomUUID()
    const sourcePath = join(sessionDir, `${sourceId}.jsonl`)
    const userUuid = randomUUID()
    const assistantUuid = randomUUID()

    const entries = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'hello' },
        uuid: userUuid,
        parentUuid: null,
        sessionId: sourceId,
        isSidechain: false,
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        uuid: assistantUuid,
        parentUuid: userUuid,
        sessionId: sourceId,
        isSidechain: false,
      }),
      JSON.stringify({
        type: 'custom-title',
        customTitle: 'My Test Session',
        sessionId: sourceId,
      }),
      JSON.stringify({
        type: 'tag',
        tag: 'important',
        sessionId: sourceId,
      }),
    ]
    writeFileSync(sourcePath, entries.join('\n') + '\n', { encoding: 'utf8' })

    const result = await forkSession(sourceId, { dir: testProjectDir })

    expect(result.session_id).toBeDefined()
    expect(result.session_id).not.toBe(sourceId)

    const forkedPath = join(sessionDir, `${result.session_id}.jsonl`)
    const forkedEntries = await readJSONLFile<any>(forkedPath)

    const titleEntry = forkedEntries.find(e => e.type === 'custom-title')
    const tagEntry = forkedEntries.find(e => e.type === 'tag')

    expect(titleEntry).toBeDefined()
    expect(titleEntry.customTitle).toBe('My Test Session')
    expect(titleEntry.sessionId).toBe(result.session_id)

    expect(tagEntry).toBeDefined()
    expect(tagEntry.tag).toBe('important')
    expect(tagEntry.sessionId).toBe(result.session_id)
  })
})
