/**
 * Local turn telemetry for autonomy (never phones home).
 * Writes JSONL under ~/.openclaude/telemetry/turns.jsonl
 */

import { appendFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { isEnvTruthy } from '../../utils/envUtils.js'

export type TurnTelemetryEvent = {
  event: 'route_select' | 'route_success' | 'route_failure' | 'circuit_trip'
  ts?: number
  sessionId?: string
  model?: string
  baseURL?: string
  tier?: string
  source?: string
  reason?: string[]
  agentName?: string
  subagentType?: string
  durationMs?: number
  success?: boolean
  error?: string
  extra?: Record<string, string | number | boolean | undefined>
}

function telemetryEnabled(): boolean {
  // Env-first so tests and CI can enable without full settings bootstrap
  if (process.env.OPENCLAUDE_AUTONOMY_TELEMETRY === '0') return false
  if (isEnvTruthy(process.env.OPENCLAUDE_AUTONOMY)) return true
  if (isEnvTruthy(process.env.OPENCLAUDE_AUTONOMY_TELEMETRY)) return true
  try {
    // Lazy: avoid loading settings graph at module init
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInitialSettings } = require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isAutonomyEnabled } = require('./routePolicy.js') as typeof import('./routePolicy.js')
    const settings = getInitialSettings()
    if (!isAutonomyEnabled(settings)) return false
    return settings.autonomy?.telemetry !== false
  } catch {
    return false
  }
}

function safeSessionId(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId } = require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    return getSessionId()
  } catch {
    return undefined
  }
}

export function getTelemetryDir(): string {
  return join(homedir(), '.openclaude', 'telemetry')
}

export function getTelemetryPath(): string {
  return join(getTelemetryDir(), 'turns.jsonl')
}

/**
 * Append one telemetry line. Fire-and-forget safe (swallows IO errors).
 */
export async function appendTurnTelemetry(
  event: TurnTelemetryEvent,
): Promise<void> {
  if (!telemetryEnabled()) return
  try {
    const dir = getTelemetryDir()
    await mkdir(dir, { recursive: true })
    const line = JSON.stringify({
      ...event,
      ts: event.ts ?? Date.now(),
      sessionId: event.sessionId ?? safeSessionId(),
    })
    await appendFile(getTelemetryPath(), line + '\n', 'utf8')
  } catch {
    // Never throw from telemetry — professional runtime must not fail turns
  }
}

/**
 * Read last N telemetry lines (for /route and doctor). Sync-friendly small reads.
 */
export async function readRecentTelemetry(
  limit = 20,
): Promise<TurnTelemetryEvent[]> {
  try {
    const { readFile } = await import('fs/promises')
    const raw = await readFile(getTelemetryPath(), 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    const slice = lines.slice(-limit)
    const out: TurnTelemetryEvent[] = []
    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as TurnTelemetryEvent)
      } catch {
        // skip bad lines
      }
    }
    return out
  } catch {
    return []
  }
}
