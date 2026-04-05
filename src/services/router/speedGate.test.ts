import { expect, test } from 'bun:test'
import { applySpeedGate } from './speedGate.js'
import type { Tier, HealthStatus } from './types.js'

function makeHealth(overrides: Partial<HealthStatus> = {}): HealthStatus {
  return {
    endpoint: 'test',
    status: 'healthy',
    latencyMs: 500,
    latencyPer1kTokens: 1000,
    lastCheck: new Date().toISOString(),
    lastError: null,
    modelLoaded: 'qwen2.5:7b',
    coldStart: false,
    ...overrides,
  }
}

test('passes through healthy T0', () => {
  const health = new Map<Tier, HealthStatus>([['T0', makeHealth()]])
  const result = applySpeedGate('T0', health)
  expect(result.finalTier).toBe('T0')
  expect(result.skippedTiers).toEqual([])
})

test('skips T0 when offline, bumps to T1', () => {
  const health = new Map<Tier, HealthStatus>([['T0', makeHealth({ status: 'offline' })]])
  const result = applySpeedGate('T0', health)
  expect(result.finalTier).toBe('T1')
  expect(result.skippedTiers).toEqual(['T0'])
})

test('skips T0 when too slow, bumps to T1', () => {
  const health = new Map<Tier, HealthStatus>([['T0', makeHealth({ latencyPer1kTokens: 5000 })]])
  const result = applySpeedGate('T0', health, 3000)
  expect(result.finalTier).toBe('T1')
  expect(result.skippedTiers).toEqual(['T0'])
})

test('skips T0 on cold start, bumps to T1', () => {
  const health = new Map<Tier, HealthStatus>([['T0', makeHealth({ coldStart: true })]])
  const result = applySpeedGate('T0', health)
  expect(result.finalTier).toBe('T1')
  expect(result.skippedTiers).toEqual(['T0'])
})

test('does NOT skip T1 for speed (only T0 gets speed-gated)', () => {
  const health = new Map<Tier, HealthStatus>([['T1', makeHealth({ latencyPer1kTokens: 5000 })]])
  const result = applySpeedGate('T1', health, 3000)
  expect(result.finalTier).toBe('T1')
})

test('skips T1 when offline, bumps to T2', () => {
  const health = new Map<Tier, HealthStatus>([['T1', makeHealth({ status: 'offline' })]])
  const result = applySpeedGate('T1', health)
  expect(result.finalTier).toBe('T2')
})

test('no health data assumes healthy (optimistic)', () => {
  const health = new Map<Tier, HealthStatus>()
  const result = applySpeedGate('T0', health)
  expect(result.finalTier).toBe('T0')
})
