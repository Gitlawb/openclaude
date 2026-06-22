import { chmod, readFile, writeFile, stat } from 'fs/promises'
import { join, dirname } from 'path'
import type { ReplayIndex, ReplayStep, ReplaySummary } from 'src/types/logs.js'
import { logForDebugging } from './debug.js'
import { logError } from './log.js'

/**
 * Get the path for a session's replay index file.
 * Pattern: <projectDir>/<sessionId>.replay.json
 */
function getReplayIndexPath(sessionId: string, transcriptPath: string): string {
  return join(dirname(transcriptPath), `${sessionId}.replay.json`)
}

/**
 * Check if a file exists.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReplaySummary(value: unknown): value is ReplaySummary {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.totalSteps === 'number' &&
    isRecord(value.toolBreakdown) &&
    Object.values(value.toolBreakdown).every(count => typeof count === 'number') &&
    Array.isArray(value.filesModified) &&
    value.filesModified.every(file => typeof file === 'string') &&
    typeof value.durationMs === 'number' &&
    typeof value.startTimestamp === 'string' &&
    typeof value.endTimestamp === 'string' &&
    typeof value.userRequests === 'number' &&
    (value.retryAttempts === undefined ||
      typeof value.retryAttempts === 'number') &&
    (value.repeatedAttempts === undefined ||
      typeof value.repeatedAttempts === 'number')
  )
}

function isOptionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every(item => typeof item === 'string'))
  )
}

function isReplayStep(value: unknown): value is ReplayStep {
  if (!isRecord(value) || typeof value.stepNumber !== 'number') {
    return false
  }

  switch (value.type) {
    case 'tool':
      return (
        typeof value.toolName === 'string' &&
        typeof value.toolUseId === 'string' &&
        isRecord(value.input) &&
        typeof value.inputSummary === 'string' &&
        (value.resultStatus === 'success' ||
          value.resultStatus === 'error' ||
          value.resultStatus === 'cancelled' ||
          value.resultStatus === 'permission_denied') &&
        (value.resultPreview === undefined ||
          typeof value.resultPreview === 'string') &&
        typeof value.durationMs === 'number' &&
        typeof value.timestamp === 'string' &&
        isOptionalStringArray(value.filesModified) &&
        (value.repeatedAttemptNumber === undefined ||
          typeof value.repeatedAttemptNumber === 'number') &&
        (value.isRepeatedAttempt === undefined ||
          typeof value.isRepeatedAttempt === 'boolean')
      )
    case 'user':
      return (
        typeof value.content === 'string' &&
        typeof value.timestamp === 'string'
      )
    case 'retry':
      return (
        (value.retryType === 'api' || value.retryType === 'permission') &&
        (value.attempt === undefined || typeof value.attempt === 'number') &&
        (value.maxRetries === undefined ||
          typeof value.maxRetries === 'number') &&
        (value.retryDelayMs === undefined ||
          typeof value.retryDelayMs === 'number') &&
        typeof value.reason === 'string' &&
        isOptionalStringArray(value.commands) &&
        typeof value.timestamp === 'string'
      )
    case 'error':
      return (
        typeof value.error === 'string' &&
        typeof value.timestamp === 'string'
      )
    default:
      return false
  }
}

function isReplayIndex(value: unknown, sessionId: string): value is ReplayIndex {
  return (
    isRecord(value) &&
    value.version === 1 &&
    value.sessionId === sessionId &&
    typeof value.createdAt === 'string' &&
    isReplaySummary(value.summary) &&
    Array.isArray(value.steps) &&
    value.steps.every(isReplayStep)
  )
}

/**
 * Load the replay index for a session.
 * First tries to load the cached .replay.json, falls back to null if not found.
 */
export async function loadReplayIndex(
  sessionId: string,
  transcriptPath: string,
): Promise<ReplayIndex | null> {
  const replayPath = getReplayIndexPath(sessionId, transcriptPath)
  
  try {
    if (await fileExists(replayPath)) {
      const content = await readFile(replayPath, 'utf-8')
      const index = JSON.parse(content) as unknown
      
      if (isReplayIndex(index, sessionId)) {
        return index
      }
      
      logForDebugging(`Replay index invalid for session ${sessionId}, ignoring`)
    }
  } catch (error) {
    logError(error)
    logForDebugging(`Failed to load replay index for session ${sessionId}: ${error}`)
  }
  
  return null
}

/**
 * Write a replay index to disk.
 */
export async function writeReplayIndex(
  sessionId: string,
  transcriptPath: string,
  index: ReplayIndex,
): Promise<void> {
  const replayPath = getReplayIndexPath(sessionId, transcriptPath)
  
  try {
    // Ensure directory exists
    const dir = dirname(replayPath)
    try {
      await stat(dir)
    } catch {
      const { mkdir } = await import('fs/promises')
      await mkdir(dir, { recursive: true, mode: 0o700 })
    }
    
    await writeFile(replayPath, JSON.stringify(index, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    })
    await chmod(replayPath, 0o600)
    logForDebugging(`Wrote replay index for session ${sessionId} to ${replayPath}`)
  } catch (error) {
    logError(error)
    logForDebugging(`Failed to write replay index for session ${sessionId}: ${error}`)
  }
}
