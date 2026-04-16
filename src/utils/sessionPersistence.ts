/**
 * Session Persistence - Save/restore conversation state
 * 
 * Provides session storage. Sessions are stored as plain JSON
 * in the config directory for simplicity.
 * 
 * Note: For production, consider adding proper encryption via
 * environment variable to enable encryption at rest.
 */

import { randomUUID } from 'crypto'
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

export interface Session {
  id: string
  messages: SessionMessage[]
  config: SessionConfig
  createdAt: number
  updatedAt: number
  deviceId?: string
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  tool_calls?: unknown[]
  tool_use_id?: string
}

export interface SessionConfig {
  model?: string
  effort?: string
  maxTokens?: number
  provider?: string
  systemPrompt?: string
}

export interface SessionMetadata {
  id: string
  createdAt: number
  updatedAt: number
  messageCount: number
  deviceId?: string
}

function getConfigDir(): string {
  const home = process.env.OPENCLAUDE_DIR ?? process.env.HOME ?? '.'
  return path.join(home, '.openclaude')
}

function getSessionsDir(): string {
  return path.join(getConfigDir(), 'sessions')
}

const SESSION_EXTENSION = '.json'

async function ensureSessionsDir(): Promise<string> {
  const sessionsPath = getSessionsDir()
  if (!existsSync(sessionsPath)) {
    await mkdir(sessionsPath, { recursive: true })
  }
  return sessionsPath
}

export async function saveSession(session: Session): Promise<string> {
  const sessionsPath = await ensureSessionsDir()
  const sessionPath = path.join(sessionsPath, session.id + SESSION_EXTENSION)
  
  session.updatedAt = Date.now()
  
  await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
  
  return sessionPath
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  const sessionsPath = await ensureSessionsDir()
  const sessionPath = path.join(sessionsPath, sessionId + SESSION_EXTENSION)
  
  if (!existsSync(sessionPath)) {
    return null
  }
  
  try {
    const data = await readFile(sessionPath, 'utf-8')
    return JSON.parse(data) as Session
  } catch {
    return null
  }
}

export async function listSessions(): Promise<SessionMetadata[]> {
  const sessionsPath = await ensureSessionsDir()
  
  if (!existsSync(sessionsPath)) {
    return []
  }
  
  const files = await readdir(sessionsPath)
  const sessions: SessionMetadata[] = []
  
  for (const file of files) {
    if (!file.endsWith(SESSION_EXTENSION)) continue
    
    try {
      const session = await loadSession(file.replace(SESSION_EXTENSION, ''))
      if (session) {
        sessions.push({
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
          deviceId: session.deviceId,
        })
      }
    } catch {
      // Skip corrupted sessions
    }
  }
  
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const sessionsPath = await ensureSessionsDir()
  const sessionPath = path.join(sessionsPath, sessionId + SESSION_EXTENSION)
  
  if (!existsSync(sessionPath)) {
    return false
  }
  
  await unlink(sessionPath)
  return true
}

export async function deleteOldSessions(maxAgeDays: number = 30): Promise<number> {
  const sessions = await listSessions()
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let deleted = 0
  
  for (const session of sessions) {
    if (session.updatedAt < cutoff) {
      await deleteSession(session.id)
      deleted++
    }
  }
  
  return deleted
}

export function createSession(
  messages: SessionMessage[] = [],
  config: SessionConfig = {},
): Session {
  return {
    id: randomUUID(),
    messages,
    config,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}