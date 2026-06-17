import { readFile, writeFile, stat } from 'fs/promises'
import { join, dirname } from 'path'
import type { ReplayIndex } from 'src/types/logs.js'
import { logForDebugging } from './debug.js'
import { logError } from './log.js'

/**
 * Get the path for a session's replay index file.
 * Pattern: <projectDir>/<sessionId>.replay.json
 */
function getReplayIndexPath(sessionId: string, transcriptPath: string): string {
  return transcriptPath.replace(/\.jsonl$/, '.replay.json')
}

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
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
      const index = JSON.parse(content) as ReplayIndex
      
      // Validate basic structure
      if (index.version === 1 && index.sessionId === sessionId && Array.isArray(index.steps)) {
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
      await mkdir(dir, { recursive: true })
    }
    
    await writeFile(replayPath, JSON.stringify(index, null, 2), 'utf-8')
    logForDebugging(`Wrote replay index for session ${sessionId} to ${replayPath}`)
  } catch (error) {
    logError(error)
    logForDebugging(`Failed to write replay index for session ${sessionId}: ${error}`)
  }
}
