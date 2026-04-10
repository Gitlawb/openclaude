/**
 * Tests for ChannelManager — CRUD, persistence, events
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChannelManager } from './channel-manager.js'

const TEST_DIR = join(tmpdir(), 'openclaude-channel-test-' + Date.now())

describe('ChannelManager', () => {
  let manager: ChannelManager

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    manager = new ChannelManager(TEST_DIR)
  })

  afterEach(() => {
    const configPath = join(TEST_DIR, 'channels.json')
    if (existsSync(configPath)) unlinkSync(configPath)
  })

  it('should add a channel', () => {
    const ch = manager.addChannel({ id: 'ch1', platform: 'telegram', enabled: true })
    assert.equal(ch.id, 'ch1')
    assert.equal(ch.platform, 'telegram')
    assert.ok(ch.createdAt)
  })

  it('should list channels', () => {
    manager.addChannel({ id: 'ch1', platform: 'telegram', enabled: true })
    manager.addChannel({ id: 'ch2', platform: 'discord', enabled: true })
    const all = manager.listChannels()
    assert.equal(all.length, 2)
    const tg = manager.listChannels('telegram')
    assert.equal(tg.length, 1)
    assert.equal(tg[0].id, 'ch1')
  })

  it('should remove a channel', () => {
    manager.addChannel({ id: 'ch1', platform: 'telegram', enabled: true })
    const removed = manager.removeChannel('ch1')
    assert.equal(removed, true)
    assert.equal(manager.listChannels().length, 0)
  })

  it('should reject duplicate channel IDs', () => {
    manager.addChannel({ id: 'ch1', platform: 'telegram', enabled: true })
    assert.throws(
      () => manager.addChannel({ id: 'ch1', platform: 'discord', enabled: true }),
      /already exists/
    )
  })

  it('should update channel config', () => {
    manager.addChannel({ id: 'ch1', platform: 'telegram', enabled: true })
    const updated = manager.configureChannel('ch1', { enabled: false, name: 'My Bot' })
    assert.equal(updated.enabled, false)
    assert.equal(updated.name, 'My Bot')
    assert.ok(updated.updatedAt)
  })

  it('should emit channel:added event', () => {
    let emitted: any = null
    manager.on('channel:added', (ch: any) => { emitted = ch })
    manager.addChannel({ id: 'ev1', platform: 'discord', enabled: true })
    assert.ok(emitted)
    assert.equal(emitted.id, 'ev1')
  })

  it('should emit channel:removed event', () => {
    manager.addChannel({ id: 'ev2', platform: 'telegram', enabled: true })
    let emitted: any = null
    manager.on('channel:removed', (ch: any) => { emitted = ch })
    manager.removeChannel('ev2')
    assert.ok(emitted)
    assert.equal(emitted.id, 'ev2')
  })

  it('should persist to disk', () => {
    manager.addChannel({ id: 'persist1', platform: 'telegram', enabled: true, name: 'Persist' })
    const manager2 = new ChannelManager(TEST_DIR)
    const channels = manager2.listChannels()
    assert.equal(channels.length, 1)
    assert.equal(channels[0].id, 'persist1')
    assert.equal(channels[0].name, 'Persist')
  })

  it('should enable/disable channels', () => {
    manager.addChannel({ id: 'tog1', platform: 'telegram', enabled: true })
    manager.setEnabled('tog1', false)
    assert.equal(manager.getChannel('tog1')!.enabled, false)
    manager.setEnabled('tog1', true)
    assert.equal(manager.getChannel('tog1')!.enabled, true)
  })

  it('should get channels by platform', () => {
    manager.addChannel({ id: 'tg1', platform: 'telegram', enabled: true })
    manager.addChannel({ id: 'dc1', platform: 'discord', enabled: true })
    manager.addChannel({ id: 'tg2', platform: 'telegram', enabled: false })
    assert.equal(manager.getChannelsByPlatform('telegram').length, 2)
    assert.equal(manager.getChannelsByPlatform('discord').length, 1)
  })
})
