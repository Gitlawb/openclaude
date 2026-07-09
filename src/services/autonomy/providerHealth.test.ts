import { describe, expect, test, beforeEach } from 'bun:test'
import {
  getHealthSnapshot,
  isProviderHealthy,
  recordFailure,
  recordSuccess,
  resetHealthRegistryForTests,
  scoreProvider,
  type ProviderHealthEntry,
} from './providerHealth.js'

describe('providerHealth', () => {
  beforeEach(() => {
    resetHealthRegistryForTests()
  })

  test('unknown provider is healthy by default', () => {
    expect(isProviderHealthy('m', 'http://localhost:11434/v1')).toBe(true)
  })

  test('two consecutive failures mark unhealthy', () => {
    const model = 'qwen2.5:7b'
    const url = 'http://localhost:11434/v1'
    recordFailure(model, url, 'econnrefused')
    expect(isProviderHealthy(model, url)).toBe(true)
    recordFailure(model, url, 'econnrefused')
    expect(isProviderHealthy(model, url)).toBe(false)
  })

  test('success resets unhealthy', () => {
    const model = 'qwen2.5:7b'
    const url = 'http://localhost:11434/v1'
    recordFailure(model, url, 'err')
    recordFailure(model, url, 'err')
    expect(isProviderHealthy(model, url)).toBe(false)
    recordSuccess(model, url, 120)
    expect(isProviderHealthy(model, url)).toBe(true)
  })

  test('EMA latency updates on success', () => {
    const model = 'm'
    const url = 'http://x/v1'
    recordSuccess(model, url, 100)
    recordSuccess(model, url, 200)
    const snap = getHealthSnapshot()
    const entry = snap.entries.find(e => e.model === model)
    expect(entry).toBeDefined()
    // α=0.3 → 0.3*200 + 0.7*100 = 130
    expect(entry!.avgLatencyMs).toBeCloseTo(130, 5)
  })

  test('unhealthy scores as infinity', () => {
    const entry: ProviderHealthEntry = {
      model: 'm',
      baseURL: 'http://x',
      latencyMs: 10,
      avgLatencyMs: 10,
      requestCount: 2,
      errorCount: 2,
      healthy: false,
      costPer1kTokens: 0,
    }
    expect(scoreProvider(entry, 'latency')).toBe(Number.POSITIVE_INFINITY)
  })

  test('snapshot includes route events', () => {
    recordSuccess('a', 'http://a', 50)
    const snap = getHealthSnapshot()
    expect(snap.recentRoutes.some(r => r.event === 'success')).toBe(true)
  })
})
