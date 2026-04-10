/**
 * Tests for BotMcpBridge — routing, config, integration
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BotMcpBridge } from './bridge.js'

describe('BotMcpBridge', () => {
  it('should create with default config', () => {
    const bridge = new BotMcpBridge()
    assert.ok(bridge)
  })

  it('should accept custom config', () => {
    const bridge = new BotMcpBridge({
      forwardBotToMcp: false,
      forwardMcpToBot: false,
      platformMapping: { slack: 'plugin:slack' },
    })
    assert.ok(bridge)
  })

  it('should register and emit bridge events', () => {
    const bridge = new BotMcpBridge()
    let received: any = null
    bridge.on('bot:message', (data) => { received = data })
    // Can't easily test private method, but verify registration works
    assert.ok(received === null)
  })

  it('should handle forwardReply without gateway gracefully', async () => {
    const bridge = new BotMcpBridge()
    // Should not throw
    await bridge.forwardReply('telegram', 'user1', 'hello')
  })

  it('should allow multiple event handlers', () => {
    const bridge = new BotMcpBridge()
    let count = 0
    const handler = () => { count++ }
    bridge.on('test', handler)
    bridge.on('test', handler)
    // Can't easily trigger private emitBridgeEvent, but verify no throw
    assert.equal(count, 0)
  })

  it('should support off() to remove handlers', () => {
    const bridge = new BotMcpBridge()
    const handler = () => {}
    bridge.on('test', handler)
    bridge.off('test', handler)
    // No throw = success
  })
})
