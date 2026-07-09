import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendTurnTelemetry,
  getTelemetryPath,
  readRecentTelemetry,
} from './telemetry.js'

describe('telemetry', () => {
  const savedHome = process.env.USERPROFILE
  const savedHomeUnix = process.env.HOME
  let tempHome: string

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'oc-telem-'))
    process.env.USERPROFILE = tempHome
    process.env.HOME = tempHome
    process.env.OPENCLAUDE_AUTONOMY = '1'
  })

  afterEach(async () => {
    if (savedHome !== undefined) process.env.USERPROFILE = savedHome
    else delete process.env.USERPROFILE
    if (savedHomeUnix !== undefined) process.env.HOME = savedHomeUnix
    else delete process.env.HOME
    delete process.env.OPENCLAUDE_AUTONOMY
    await rm(tempHome, { recursive: true, force: true }).catch(() => {})
  })

  test('appendTurnTelemetry writes jsonl when OPENCLAUDE_AUTONOMY=1', async () => {
    await appendTurnTelemetry({
      event: 'route_select',
      model: 'qwen2.5:7b',
      baseURL: 'http://localhost:11434/v1',
      tier: 'trivial',
      reason: ['test'],
      sessionId: 'test-session',
    })
    const raw = await readFile(getTelemetryPath(), 'utf8')
    expect(raw).toContain('qwen2.5:7b')
    expect(raw).toContain('route_select')
    const recent = await readRecentTelemetry(5)
    expect(recent.length).toBeGreaterThanOrEqual(1)
    expect(recent[recent.length - 1]?.model).toBe('qwen2.5:7b')
  })
})
