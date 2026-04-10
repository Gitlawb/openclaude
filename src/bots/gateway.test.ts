/**
 * Tests for BotGateway — lifecycle, routing, dynamic adapters
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BotGateway } from './manager.js'

describe('BotGateway', () => {
  it('should create with empty config', () => {
    const gw = new BotGateway({})
    assert.ok(gw)
  })

  it('should return empty statuses with no adapters', () => {
    const gw = new BotGateway({})
    const statuses = gw.getAllStatuses()
    assert.deepEqual(statuses, {})
  })

  it('should handle onMessage before start', async () => {
    const gw = new BotGateway({})
    let called = false
    gw.onMessage(async () => { called = true })
    // Should not throw
    assert.equal(called, false)
  })

  it('should shutdown gracefully with no adapters', async () => {
    const gw = new BotGateway({})
    // Should not throw
    await gw.shutdown('test')
  })
})
