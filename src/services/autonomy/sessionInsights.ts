/**
 * End-of-session / end-of-turn insight extraction from local telemetry.
 * Writes candidate knowledge to ~/.openclaude/insights/
 */

import { mkdir, writeFile, readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getTelemetryPath, type TurnTelemetryEvent } from './telemetry.js'

export function getInsightsDir(): string {
  return join(homedir(), '.openclaude', 'insights')
}

function insightsEnabled(): boolean {
  if (isEnvTruthy(process.env.OPENCLAUDE_AUTONOMY)) return true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInitialSettings } = require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isAutonomyEnabled } = require('./routePolicy.js') as typeof import('./routePolicy.js')
    return isAutonomyEnabled(getInitialSettings())
  } catch {
    return false
  }
}

function safeSessionId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId } = require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    return getSessionId()
  } catch {
    return 'unknown-session'
  }
}

async function loadSessionTelemetry(
  sessionId: string,
): Promise<TurnTelemetryEvent[]> {
  try {
    const raw = await readFile(getTelemetryPath(), 'utf8')
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as TurnTelemetryEvent
        } catch {
          return null
        }
      })
      .filter((e): e is TurnTelemetryEvent => e !== null && e.sessionId === sessionId)
  } catch {
    return []
  }
}

function summarize(events: TurnTelemetryEvent[]): string[] {
  const bullets: string[] = []
  const byTier = new Map<string, number>()
  const byModel = new Map<string, number>()
  let failures = 0
  let fallbacks = 0

  for (const e of events) {
    if (e.tier) byTier.set(e.tier, (byTier.get(e.tier) ?? 0) + 1)
    if (e.model) byModel.set(e.model, (byModel.get(e.model) ?? 0) + 1)
    if (e.event === 'route_failure') failures++
    if (e.source === 'fallback' || e.source === 'health-override') fallbacks++
  }

  if (byTier.size > 0) {
    const tiers = [...byTier.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}×${n}`)
      .join(', ')
    bullets.push(`Tiers usados nesta sessão: ${tiers}`)
  }

  if (byModel.size > 0) {
    const models = [...byModel.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([m, n]) => `${m} (${n})`)
      .join(', ')
    bullets.push(`Modelos: ${models}`)
  }

  if (failures > 0) {
    bullets.push(`Falhas de provider registradas: ${failures}`)
  }
  if (fallbacks > 0) {
    bullets.push(`Fallbacks / health-overrides: ${fallbacks}`)
  }

  // Policy suggestions
  const trivial = byTier.get('trivial') ?? 0
  const hard = byTier.get('hard') ?? 0
  if (trivial >= 3 && hard === 0) {
    bullets.push(
      'Sugestão: sessão majoritariamente trivial — manter taskRouting.trivial em modelo local pequeno.',
    )
  }
  if (hard >= 2) {
    bullets.push(
      'Sugestão: várias tarefas hard — garantir fallbackChains.hard com pelo menos 2 modelos.',
    )
  }
  if (fallbacks >= 2) {
    bullets.push(
      'Sugestão: muitos fallbacks — checar saúde do provider principal (doctor:autonomy:probe).',
    )
  }

  if (bullets.length === 0) {
    bullets.push('Sem eventos de autonomy suficientes para insights nesta sessão.')
  }

  return bullets.slice(0, 7)
}

/**
 * Write a markdown insight file for the current session. Returns path or null.
 */
export async function writeSessionInsights(options?: {
  sessionId?: string
}): Promise<{ path: string; bullets: string[] } | null> {
  if (!insightsEnabled()) return null

  const sessionId = options?.sessionId ?? safeSessionId()
  const events = await loadSessionTelemetry(sessionId)
  if (events.length === 0) return null

  const bullets = summarize(events)
  const dir = getInsightsDir()
  await mkdir(dir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const path = join(dir, `${date}_${sessionId.slice(0, 8)}.md`)

  const body = [
    `# Session Insight — ${date}`,
    '',
    `**Session ID:** ${sessionId}`,
    `**Events:** ${events.length}`,
    '',
    '## O que aconteceu',
    '',
    ...bullets.map(b => `- ${b}`),
    '',
    '## Promoção de conhecimento',
    '',
    'Revise e, se válido, copie para `docs/superpowers/knowledge/` ou use `/promote-knowledge`.',
    '',
    '```json',
    JSON.stringify(
      {
        eventCount: events.length,
        models: [...new Set(events.map(e => e.model).filter(Boolean))],
        tiers: [...new Set(events.map(e => e.tier).filter(Boolean))],
      },
      null,
      2,
    ),
    '```',
    '',
  ].join('\n')

  await writeFile(path, body, 'utf8')
  return { path, bullets }
}

export async function listInsightFiles(): Promise<string[]> {
  try {
    const dir = getInsightsDir()
    const files = await readdir(dir)
    return files.filter(f => f.endsWith('.md')).sort().reverse()
  } catch {
    return []
  }
}
