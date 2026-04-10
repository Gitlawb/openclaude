/**
 * Tests for MessageBus — routing, subscriptions, error handling
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MessageBus } from '../bus/index.js'
import type { BotMessage } from '../bots/base/adapter.js'

function makeMsg(platform: string, content = 'test'): BotMessage {
  return {
    id: 'test-id',
    sessionId: 's1',
    userId: 'user1',
    content,
    platform: platform as any,
    timestamp: new Date(),
    metadata: {},
  }
}

describe('MessageBus', () => {
  it('should route to platform-specific handlers', async () => {
    const bus = new MessageBus()
    let telegramReceived = false
    let discordReceived = false

    bus.subscribe('telegram', async () => { telegramReceived = true })
    bus.subscribe('discord', async () => { discordReceived = true })

    await bus.publish(makeMsg('telegram'))
    assert.equal(telegramReceived, true)
    assert.equal(discordReceived, false)
  })

  it('should route to global handlers', async () => {
    const bus = new MessageBus()
    let count = 0

    bus.subscribeAll(async () => { count++ })

    await bus.publish(makeMsg('telegram'))
    await bus.publish(makeMsg('discord'))
    assert.equal(count, 2)
  })

  it('should unsubscribe correctly', async () => {
    const bus = new MessageBus()
    let count = 0
    const handler = async () => { count++ }

    bus.subscribe('telegram', handler)
    await bus.publish(makeMsg('telegram'))
    assert.equal(count, 1)

    bus.unsubscribe('telegram', handler)
    await bus.publish(makeMsg('telegram'))
    assert.equal(count, 1) // no additional calls
  })

  it('should unsubscribeAll', async () => {
    const bus = new MessageBus()
    let count = 0
    const handler = async () => { count++ }

    bus.subscribeAll(handler)
    await bus.publish(makeMsg('telegram'))
    assert.equal(count, 1)

    bus.unsubscribeAll(handler)
    await bus.publish(makeMsg('telegram'))
    assert.equal(count, 1)
  })

  it('should handle errors in handlers without crashing', async () => {
    const bus = new MessageBus()
    let errored = false

    bus.on('error', () => { errored = true })
    bus.subscribe('telegram', async () => { throw new Error('boom') })

    await bus.publish(makeMsg('telegram'))
    assert.equal(errored, true)
  })

  it('should clear all handlers', async () => {
    const bus = new MessageBus()
    let count = 0
    bus.subscribeAll(async () => { count++ })
    bus.subscribe('telegram', async () => { count++ })

    bus.clear()
    await bus.publish(makeMsg('telegram'))
    assert.equal(count, 0)
  })
})
