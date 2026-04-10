/**
 * Tests for HealthReport — status calculation, uptime formatting
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildHealthReport } from './health.js'

// Minimal mock gateway
function createMockGateway(statuses: Record<string, any>) {
  return {
    getAllStatuses: () => statuses,
  } as any
}

describe('HealthReport', () => {
  it('should report ok when all adapters connected', () => {
    const gateway = createMockGateway({
      telegram: { type: 'telegram', enabled: true, connected: true, uptime: 60000, reconnectCount: 0 },
    })
    const report = buildHealthReport(gateway, new Date(Date.now() - 60000))
    assert.equal(report.status, 'ok')
    assert.equal(report.adapters.telegram.connected, true)
  })

  it('should report degraded when an adapter is disconnected', () => {
    const gateway = createMockGateway({
      telegram: { type: 'telegram', enabled: true, connected: false, uptime: 0, reconnectCount: 1, lastError: 'timeout' },
      discord: { type: 'discord', enabled: true, connected: true, uptime: 30000, reconnectCount: 0 },
    })
    const report = buildHealthReport(gateway, new Date(Date.now() - 30000))
    assert.equal(report.status, 'degraded')
    assert.equal(report.adapters.telegram.lastError, 'timeout')
  })

  it('should report down when no adapters', () => {
    const gateway = createMockGateway({})
    const report = buildHealthReport(gateway, new Date())
    assert.equal(report.status, 'down')
  })

  it('should format uptime correctly', () => {
    const gateway = createMockGateway({
      telegram: { type: 'telegram', enabled: true, connected: true, uptime: 90061000, reconnectCount: 0 },
    })
    // 1d 1h 1m 1s ≈ 90061000ms
    const report = buildHealthReport(gateway, new Date(Date.now() - 90061000))
    assert.ok(report.uptimeHuman.includes('d'))
    assert.ok(report.uptimeHuman.includes('h'))
    assert.equal(report.status, 'ok')
  })

  it('should include timestamp', () => {
    const gateway = createMockGateway({})
    const report = buildHealthReport(gateway, new Date())
    assert.ok(report.timestamp)
    assert.ok(report.startedAt)
  })
})
