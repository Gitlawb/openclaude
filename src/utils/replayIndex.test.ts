import { chmod, mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'

import type { ReplayIndex } from 'src/types/logs.js'
import { fileExists, loadReplayIndex, writeReplayIndex } from './replayIndex.js'

const testRoot = join(process.cwd(), '.tmp-replay-index-tests')

function makeIndex(sessionId: string): ReplayIndex {
  return {
    sessionId,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    summary: {
      totalSteps: 0,
      toolBreakdown: {},
      filesModified: [],
      durationMs: 0,
      startTimestamp: '2026-01-01T00:00:00.000Z',
      endTimestamp: '2026-01-01T00:00:00.000Z',
      userRequests: 0,
      retryAttempts: 0,
      repeatedAttempts: 0,
    },
    steps: [],
  }
}

afterEach(async () => {
  const { rm } = await import('fs/promises')
  await rm(testRoot, { recursive: true, force: true })
})

describe('replay index storage', () => {
  test('fileExists returns false only for missing files', async () => {
    await expect(fileExists(join(testRoot, 'missing.replay.json'))).resolves.toBe(
      false,
    )

    await expect(fileExists('\0')).rejects.toThrow()
  })

  test('writes replay sidecar by session id without replacing arbitrary transcript suffixes', async () => {
    const sessionId = 'session-abc'
    const projectDir = join(testRoot, 'project')
    const transcriptPath = join(projectDir, 'transcript-without-jsonl')
    const index = makeIndex(sessionId)

    await mkdir(projectDir, { recursive: true })
    await writeFile(transcriptPath, 'original transcript', 'utf-8')

    await writeReplayIndex(sessionId, transcriptPath, index)

    expect(await readFile(transcriptPath, 'utf-8')).toBe('original transcript')
    expect(await loadReplayIndex(sessionId, transcriptPath)).toEqual(index)
    expect(
      await readFile(join(projectDir, `${sessionId}.replay.json`), 'utf-8'),
    ).toContain('"sessionId": "session-abc"')
  })

  test('creates replay sidecars with owner-only permissions on platforms that expose mode bits', async () => {
    const sessionId = 'session-perms'
    const replayPath = join(testRoot, 'project', `${sessionId}.replay.json`)

    await writeReplayIndex(
      sessionId,
      join(testRoot, 'project', `${sessionId}.jsonl`),
      makeIndex(sessionId),
    )

    const stats = await stat(replayPath)
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600)
    } else {
      expect(stats.isFile()).toBe(true)
    }
  })

  test('rewrites replay sidecars with owner-only permissions on platforms that expose mode bits', async () => {
    const sessionId = 'session-rewrite-perms'
    const projectDir = join(testRoot, 'project')
    const transcriptPath = join(projectDir, `${sessionId}.jsonl`)
    const replayPath = join(projectDir, `${sessionId}.replay.json`)

    await mkdir(projectDir, { recursive: true })
    await writeFile(replayPath, JSON.stringify(makeIndex(sessionId)), {
      encoding: 'utf-8',
      mode: 0o666,
    })
    if (process.platform !== 'win32') {
      await chmod(replayPath, 0o666)
    }

    await writeReplayIndex(sessionId, transcriptPath, makeIndex(sessionId))

    const stats = await stat(replayPath)
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600)
    } else {
      expect(stats.isFile()).toBe(true)
    }
  })

  test('creates missing replay sidecar directories with owner-only permissions', async () => {
    const sessionId = 'session-dir-perms'
    const projectDir = join(testRoot, 'new-project')

    await writeReplayIndex(
      sessionId,
      join(projectDir, `${sessionId}.jsonl`),
      makeIndex(sessionId),
    )

    const stats = await stat(projectDir)
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o700)
    } else {
      expect(stats.isDirectory()).toBe(true)
    }
  })

  test('ignores malformed replay sidecars without a valid summary', async () => {
    const sessionId = 'session-malformed'
    const projectDir = join(testRoot, 'project')
    const transcriptPath = join(projectDir, `${sessionId}.jsonl`)

    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, `${sessionId}.replay.json`),
      JSON.stringify({
        sessionId,
        version: 1,
        steps: [],
      }),
      'utf-8',
    )

    expect(await loadReplayIndex(sessionId, transcriptPath)).toBe(null)
  })

  test('ignores replay sidecars with array-shaped summary records', async () => {
    const sessionId = 'session-array-summary'
    const projectDir = join(testRoot, 'project')
    const transcriptPath = join(projectDir, `${sessionId}.jsonl`)

    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, `${sessionId}.replay.json`),
      JSON.stringify({
        sessionId,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        summary: {
          totalSteps: 0,
          toolBreakdown: [],
          filesModified: [],
          durationMs: 0,
          startTimestamp: '2026-01-01T00:00:00.000Z',
          endTimestamp: '2026-01-01T00:00:00.000Z',
          userRequests: 0,
        },
        steps: [],
      }),
      'utf-8',
    )

    expect(await loadReplayIndex(sessionId, transcriptPath)).toBe(null)
  })

  test('ignores replay sidecars with malformed steps', async () => {
    const sessionId = 'session-malformed-step'
    const projectDir = join(testRoot, 'project')
    const transcriptPath = join(projectDir, `${sessionId}.jsonl`)
    const index = makeIndex(sessionId)

    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, `${sessionId}.replay.json`),
      JSON.stringify({
        ...index,
        steps: [
          {
            type: 'tool',
            stepNumber: 1,
          },
        ],
      }),
      'utf-8',
    )

    expect(await loadReplayIndex(sessionId, transcriptPath)).toBe(null)
  })
})
