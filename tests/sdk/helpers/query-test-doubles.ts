import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getProjectDir } from '../../../src/utils/sessionStoragePortable.js'
import type { Query } from '../../../src/entrypoints/sdk/index.js'

let tempDirLockPromise: Promise<void> | null = null

/**
 * Creates a temp directory and returns its path.
 * Caller is responsible for cleanup (use withTempDir for auto-cleanup).
 */
export function createTempDir(prefix: string = 'sdk-test'): string {
  const dir = join(tmpdir(), `${prefix}-${process.pid}-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Creates a temp directory, runs the callback, then cleans up.
 * Returns the callback's result.
 */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
  prefix: string = 'sdk-test',
): Promise<T> {
  while (tempDirLockPromise) {
    await tempDirLockPromise
  }

  let releaseLock: (() => void) | undefined
  tempDirLockPromise = new Promise<void>(resolve => {
    releaseLock = resolve
  })

  const dir = createTempDir(prefix)
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  const previousSimpleMode = process.env.CLAUDE_CODE_SIMPLE
  process.env.CLAUDE_CONFIG_DIR = dir
  process.env.CLAUDE_CODE_SIMPLE = '1'
  try {
    return await fn(dir)
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    }
    if (previousSimpleMode === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = previousSimpleMode
    }
    rmSync(dir, { recursive: true, force: true })
    tempDirLockPromise = null
    releaseLock?.()
  }
}

/**
 * Creates a fake session JSONL file in the correct project directory
 * for the given `cwd`. Returns the session directory path.
 *
 * The JSONL file is placed at `<projects-dir>/<sanitized-cwd>/<sessionId>.jsonl`.
 */
export function createSessionJsonl(
  cwd: string,
  sessionId: string,
  entries: Array<Record<string, unknown>>,
): string {
  const canonicalCwd = (() => {
    try {
      return realpathSync(cwd)
    } catch {
      return cwd
    }
  })()
  const sessionDir = getProjectDir(canonicalCwd)
  mkdirSync(sessionDir, { recursive: true })
  const filePath = join(sessionDir, `${sessionId}.jsonl`)
  const lines = entries.map(e => JSON.stringify(e))
  writeFileSync(filePath, lines.join('\n') + '\n', { encoding: 'utf8' })
  return sessionDir
}

/**
 * Generates a minimal conversation JSONL entry set: one user + one assistant message.
 * Returns entries with valid UUID chains.
 */
export function createMinimalConversation(sessionId: string): Array<Record<string, unknown>> {
  const userUuid = randomUUID()
  const assistantUuid = randomUUID()
  return [
    {
      type: 'user',
      message: { role: 'user', content: 'hello from test' },
      uuid: userUuid,
      parentUuid: null,
      sessionId,
      isSidechain: false,
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi from assistant' }] },
      uuid: assistantUuid,
      parentUuid: userUuid,
      sessionId,
      isSidechain: false,
    },
  ]
}

/**
 * Generates a multi-turn conversation with `turns` user/assistant pairs.
 * Each pair links via parentUuid chain.
 */
export function createMultiTurnConversation(
  sessionId: string,
  turns: number,
): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = []
  let lastUuid: string | null = null

  for (let i = 0; i < turns; i++) {
    const userUuid = randomUUID()
    const assistantUuid = randomUUID()

    entries.push({
      type: 'user',
      message: { role: 'user', content: `turn ${i + 1}` },
      uuid: userUuid,
      parentUuid: lastUuid,
      sessionId,
      isSidechain: false,
    })

    entries.push({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: `response ${i + 1}` }] },
      uuid: assistantUuid,
      parentUuid: userUuid,
      sessionId,
      isSidechain: false,
    })

    lastUuid = assistantUuid
  }

  return entries
}

/**
 * Safely drains a query's async iterator, catching any abort errors.
 * Returns all collected SDKMessages.
 */
export async function drainQuery(q: Query): Promise<unknown[]> {
  const messages: unknown[] = []
  try {
    for await (const msg of q) {
      messages.push(msg)
    }
  } catch {
    // AbortError or similar — expected when interrupt/close is called
  }
  return messages
}

/**
 * Collects all messages from a query without suppressing errors.
 * Use when you expect the query to complete normally.
 */
export async function collectMessages(q: Query): Promise<unknown[]> {
  const messages: unknown[] = []
  for await (const msg of q) {
    messages.push(msg)
  }
  return messages
}

/**
 * Creates a UUID regex pattern for validation.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
