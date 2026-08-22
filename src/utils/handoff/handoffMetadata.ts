import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getProjectDir } from '../sessionStorage.js'

export type HandoffStatus =
  | 'spawning'
  | 'running'
  | 'done'
  | 'failed'
  | 'killed'
  | 'orphaned'

export type HandoffMetadata = {
  handoffId: string
  parentSessionId: string | null
  pid: number | null
  status: HandoffStatus
  startedAt: number
  finishedAt: number | null
  prompt: string
  cwd: string
  logPath: string
  exitCode: number | null
  binaryPath: string
}

export function getHandoffsDir(): string {
  const dir = join(getProjectDir(getOriginalCwd()), 'handoffs')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getHandoffMetadataPath(handoffId: string): string {
  return join(getHandoffsDir(), `${handoffId}.json`)
}

export function getHandoffLogPath(handoffId: string): string {
  return join(getHandoffsDir(), `${handoffId}.log`)
}

export function generateHandoffId(): string {
  return `handoff_${randomBytes(4).toString('hex')}`
}

export function writeHandoffMetadata(meta: HandoffMetadata): void {
  writeFileSync(getHandoffMetadataPath(meta.handoffId), JSON.stringify(meta, null, 2))
}

export function readHandoffMetadata(handoffId: string): HandoffMetadata | null {
  const path = getHandoffMetadataPath(handoffId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HandoffMetadata
  } catch {
    return null
  }
}

export function listHandoffMetadata(): HandoffMetadata[] {
  const dir = getHandoffsDir()
  if (!existsSync(dir)) return []
  const out: HandoffMetadata[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const handoffId = name.slice(0, -'.json'.length)
    const meta = readHandoffMetadata(handoffId)
    if (meta) out.push(meta)
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
}

export function deleteHandoffMetadata(handoffId: string): void {
  const metaPath = getHandoffMetadataPath(handoffId)
  const logPath = getHandoffLogPath(handoffId)
  if (existsSync(metaPath)) unlinkSync(metaPath)
  if (existsSync(logPath)) unlinkSync(logPath)
}

export function isPidAlive(pid: number | null): boolean {
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function refreshHandoffStatus(meta: HandoffMetadata): HandoffMetadata {
  if (meta.status === 'done' || meta.status === 'failed' || meta.status === 'killed') {
    return meta
  }
  if (meta.pid === null) return meta
  if (isPidAlive(meta.pid)) {
    if (meta.status === 'spawning') {
      const updated: HandoffMetadata = { ...meta, status: 'running' }
      writeHandoffMetadata(updated)
      return updated
    }
    return meta
  }
  const updated: HandoffMetadata = {
    ...meta,
    status: 'orphaned',
    finishedAt: meta.finishedAt ?? Date.now(),
  }
  writeHandoffMetadata(updated)
  return updated
}

export function getLogTail(handoffId: string, maxBytes = 8192): string {
  const path = getHandoffLogPath(handoffId)
  if (!existsSync(path)) return ''
  try {
    const stat = statSync(path)
    const buf = readFileSync(path)
    if (stat.size <= maxBytes) return buf.toString('utf8')
    return '...\n' + buf.subarray(stat.size - maxBytes).toString('utf8')
  } catch {
    return ''
  }
}
