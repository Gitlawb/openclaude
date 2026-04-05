import { expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HealthMonitor } from './healthMonitor.js'
import type { TierConfig } from './types.js'

let tempDir: string

beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'health-test-')) })
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }) })

test('starts with empty statuses', () => {
  const monitor = new HealthMonitor(tempDir)
  expect(monitor.getAllStatuses().size).toBe(0)
})

test('checkEndpoint returns offline for unreachable endpoint', async () => {
  const tiers = {
    T0: { tier: 'T0' as const, name: 'Bad Ollama', model: 'test', baseURL: 'http://localhost:99999/v1', apiKeyEnv: 'TEST_KEY', maxContext: 32000, workBudget: 8000, inputPricePerM: 0, outputPricePerM: 0 },
  } as Record<any, TierConfig>
  const monitor = new HealthMonitor(tempDir, tiers as any)
  const status = await monitor.checkEndpoint('T0')
  expect(status.status).toBe('offline')
  expect(status.lastError).toBeTruthy()
})

test('stop clears interval', () => {
  const monitor = new HealthMonitor(tempDir)
  monitor.start(600000)
  expect(monitor['intervalHandle']).not.toBeNull()
  monitor.stop()
  expect(monitor['intervalHandle']).toBeNull()
})

test('formatStatusBanner produces readable output', () => {
  const monitor = new HealthMonitor(tempDir)
  monitor['statuses'].set('T1', {
    endpoint: 'T1-DeepSeek', status: 'healthy', latencyMs: 300, latencyPer1kTokens: 600,
    lastCheck: new Date().toISOString(), lastError: null, modelLoaded: 'deepseek-chat', coldStart: false,
  })
  const banner = monitor.formatStatusBanner()
  expect(banner).toContain('Provider Health:')
  expect(banner).toContain('healthy')
  expect(banner).toContain('DeepSeek')
})

test('creates status files after checkAll', async () => {
  const tiers = {
    T0: { tier: 'T0' as const, name: 'Bad', model: 'test', baseURL: 'http://localhost:99999/v1', apiKeyEnv: 'X', maxContext: 32000, workBudget: 8000, inputPricePerM: 0, outputPricePerM: 0 },
  } as Record<any, TierConfig>
  const monitor = new HealthMonitor(tempDir, tiers as any)
  await monitor.checkAll()
  expect(existsSync(join(tempDir, '.openclaude', 'health-status.json'))).toBe(true)
  expect(existsSync(join(tempDir, '.openclaude', 'router-status.txt'))).toBe(true)
})
