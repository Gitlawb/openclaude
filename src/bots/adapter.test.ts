/**
 * Tests for BaseAdapter — lifecycle, status, auth, message flow
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BaseAdapter, type BotMessage, type AdapterConfig } from './base/adapter.js'

class TestAdapter extends BaseAdapter {
  private _connected = false
  shouldFailStart = false

  constructor(config: AdapterConfig) {
    super('test', config)
  }

  async initialize(): Promise<void> { /* no-op */ }
  async start(): Promise<void> {
    if (this.shouldFailStart) throw new Error('start failed')
    this._connected = true
    this.startTime = new Date()
  }
  async stop(): Promise<void> { this._connected = false }
  async sendMessage(_userId: string, content: string): Promise<void> {
    this.emitMessage({
      id: 'test-id',
      sessionId: 's1',
      userId: _userId,
      content,
      platform: 'test',
      timestamp: new Date(),
      metadata: {},
    })
  }
  protected isConnected(): boolean { return this._connected }
  triggerError(err: Error) { this.emitError(err) }
  checkAuth(userId: string, allowFrom?: string[]) {
    return this.isUserAuthorized(userId, allowFrom)
  }
}

describe('BaseAdapter', () => {
  it('should create with correct config', () => {
    const adapter = new TestAdapter({ enabled: true })
    const status = adapter.getStatus()
    assert.equal(status.type, 'test')
    assert.equal(status.enabled, true)
    assert.equal(status.connected, false)
    assert.equal(status.uptime, 0)
    assert.equal(status.reconnectCount, 0)
  })

  it('should track uptime after start', async () => {
    const adapter = new TestAdapter({ enabled: true })
    await adapter.initialize()
    await adapter.start()
    await new Promise(r => setTimeout(r, 10))
    const status = adapter.getStatus()
    assert.equal(status.connected, true)
    assert.ok(status.uptime >= 0)
  })

  it('should emit messages', async () => {
    const adapter = new TestAdapter({ enabled: true })
    let received: BotMessage | null = null
    adapter.on('message', (msg: BotMessage) => { received = msg })
    await adapter.sendMessage('user1', 'hello')
    assert.ok(received)
    assert.equal(received!.content, 'hello')
    assert.equal(received!.platform, 'test')
  })

  it('should track error state', () => {
    const adapter = new TestAdapter({ enabled: true })
    let errorEmitted = false
    adapter.on('error', () => { errorEmitted = true })
    adapter.triggerError(new Error('test error'))
    assert.ok(errorEmitted)
    assert.equal(adapter.getStatus().lastError, 'test error')
  })

  it('should authorize users correctly', () => {
    const adapter = new TestAdapter({ enabled: true })
    // No allowFrom = everyone authorized
    assert.equal(adapter.checkAuth('user1'), true)
    // With allowFrom = only listed users
    assert.equal(adapter.checkAuth('user1', ['user1', 'user2']), true)
    assert.equal(adapter.checkAuth('user3', ['user1', 'user2']), false)
    // Empty allowFrom = everyone
    assert.equal(adapter.checkAuth('user1', []), true)
  })

  it('should stop cleanly', async () => {
    const adapter = new TestAdapter({ enabled: true })
    await adapter.start()
    assert.equal(adapter.getStatus().connected, true)
    await adapter.stop()
    assert.equal(adapter.getStatus().connected, false)
  })
})
