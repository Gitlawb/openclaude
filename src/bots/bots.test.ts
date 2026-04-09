/**
 * Comprehensive tests for the bots module
 *
 * Tests: BaseAdapter, MessageBus, ChannelManager, BotGateway, Health
 * Run: bun test src/bots/bots.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Module imports ─────────────────────────────────────────────────────────

import { BaseAdapter, type BotMessage, type BotStatus, type AdapterConfig } from './base/adapter.js';
import { MessageBus } from '../bus/index.js';
import { ChannelManager } from './channel-manager.js';
import { BotGateway } from './manager.js';
import { buildHealthReport } from './health.js';

// ─── BotTool import ─────────────────────────────────────────────────────────

import { BotTool } from '../tools/BotTool/BotTool.js';
import { BOT_TOOL_NAME, DESCRIPTION } from '../tools/BotTool/prompt.js';
import {
  renderToolUseMessage,
  getToolUseSummary,
  renderToolResultMessage,
} from '../tools/BotTool/UI.js';

// ─── Concrete test adapter ──────────────────────────────────────────────────

class TestAdapter extends BaseAdapter {
  private _connected = false;
  private _shouldFailInit = false;
  private _shouldFailStart = false;
  sentMessages: Array<{ userId: string; content: string; metadata?: Record<string, unknown> }> = [];

  constructor(config: AdapterConfig & { shouldFailInit?: boolean; shouldFailStart?: boolean }) {
    super('test', config);
    this._shouldFailInit = config.shouldFailInit ?? false;
    this._shouldFailStart = config.shouldFailStart ?? false;
  }

  async initialize(): Promise<void> {
    if (this._shouldFailInit) throw new Error('Init failure');
  }

  async start(): Promise<void> {
    if (this._shouldFailStart) throw new Error('Start failure');
    this._connected = true;
    this.startTime = new Date();
  }

  async stop(): Promise<void> {
    this._connected = false;
  }

  async sendMessage(userId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    this.sentMessages.push({ userId, content, metadata });
  }

  protected isConnected(): boolean {
    return this._connected;
  }

  // Test helper: simulate incoming message
  simulateMessage(content: string, userId = 'user-123'): void {
    const msg: BotMessage = {
      id: crypto.randomUUID(),
      sessionId: `test-${userId}`,
      userId,
      content,
      platform: 'test',
      timestamp: new Date(),
      metadata: {},
    };
    this.emitMessage(msg);
  }

  // Test helper: simulate error
  simulateError(msg = 'Test error'): void {
    this.emitError(new Error(msg));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASE ADAPTER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('BaseAdapter', () => {
  it('should initialize with correct platform and config', () => {
    const adapter = new TestAdapter({ enabled: true });
    assert.equal(adapter.getStatus().type, 'test');
    assert.equal(adapter.getStatus().enabled, true);
    assert.equal(adapter.getStatus().connected, false);
  });

  it('should track connection status', async () => {
    const adapter = new TestAdapter({ enabled: true });
    assert.equal(adapter.getStatus().connected, false);
    await adapter.initialize();
    await adapter.start();
    assert.equal(adapter.getStatus().connected, true);
    await adapter.stop();
    assert.equal(adapter.getStatus().connected, false);
  });

  it('should track uptime after start', async () => {
    const adapter = new TestAdapter({ enabled: true });
    assert.equal(adapter.getStatus().uptime, 0);
    await adapter.initialize();
    await adapter.start();
    // Small delay to ensure uptime > 0
    await Bun.sleep(10);
    assert.ok(adapter.getStatus().uptime > 0);
  });

  it('should emit message events', async () => {
    const adapter = new TestAdapter({ enabled: true });
    const messages: BotMessage[] = [];
    adapter.on('message', (msg: BotMessage) => messages.push(msg));

    adapter.simulateMessage('hello');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'hello');
    assert.equal(messages[0].userId, 'user-123');
    assert.equal(messages[0].platform, 'test');
  });

  it('should emit error events and set lastError', async () => {
    const adapter = new TestAdapter({ enabled: true });
    const errors: Error[] = [];
    adapter.on('error', (err: Error) => errors.push(err));

    adapter.simulateError('connection lost');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'connection lost');
    assert.equal(adapter.getStatus().lastError, 'connection lost');
  });

  it('should authorize users when allowFrom is empty', () => {
    const adapter = new TestAdapter({ enabled: true, allowFrom: [] });
    // @ts-expect-accessing protected method via cast
    assert.equal((adapter as any).isUserAuthorized('anyone'), true);
  });

  it('should restrict users when allowFrom is set', () => {
    const adapter = new TestAdapter({ enabled: true, allowFrom: ['alice', 'bob'] });
    // @ts-expect-accessing protected method via cast
    assert.equal((adapter as any).isUserAuthorized('alice', ['alice', 'bob']), true);
    assert.equal((adapter as any).isUserAuthorized('bob', ['alice', 'bob']), true);
    assert.equal((adapter as any).isUserAuthorized('eve', ['alice', 'bob']), false);
  });

  it('should send messages and track them', async () => {
    const adapter = new TestAdapter({ enabled: true });
    await adapter.sendMessage('user-456', 'test response', { chatId: '789' });
    assert.equal(adapter.sentMessages.length, 1);
    assert.equal(adapter.sentMessages[0].userId, 'user-456');
    assert.equal(adapter.sentMessages[0].content, 'test response');
    assert.deepEqual(adapter.sentMessages[0].metadata, { chatId: '789' });
  });

  it('should handle init failure gracefully', async () => {
    const adapter = new TestAdapter({ enabled: true, shouldFailInit: true });
    await assert.rejects(() => adapter.initialize(), { message: 'Init failure' });
  });

  it('should handle start failure gracefully', async () => {
    const adapter = new TestAdapter({ enabled: true, shouldFailStart: true });
    await adapter.initialize();
    await assert.rejects(() => adapter.start(), { message: 'Start failure' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE BUS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  afterEach(() => {
    bus.clear();
  });

  function makeMessage(platform = 'telegram', content = 'hi'): BotMessage {
    return {
      id: crypto.randomUUID(),
      sessionId: `${platform}-user1`,
      userId: 'user1',
      content,
      platform: platform as any,
      timestamp: new Date(),
      metadata: {},
    };
  }

  it('should deliver messages to platform-specific subscribers', async () => {
    const received: BotMessage[] = [];
    bus.subscribe('telegram', async (msg) => { received.push(msg); });

    await bus.publish(makeMessage('telegram', 'hello'));
    assert.equal(received.length, 1);
    assert.equal(received[0].content, 'hello');
  });

  it('should NOT deliver to wrong platform subscribers', async () => {
    const telegramMsgs: BotMessage[] = [];
    const discordMsgs: BotMessage[] = [];
    bus.subscribe('telegram', async (msg) => { telegramMsgs.push(msg); });
    bus.subscribe('discord', async (msg) => { discordMsgs.push(msg); });

    await bus.publish(makeMessage('telegram'));
    assert.equal(telegramMsgs.length, 1);
    assert.equal(discordMsgs.length, 0);
  });

  it('should deliver to global subscribers', async () => {
    const all: BotMessage[] = [];
    bus.subscribeAll(async (msg) => { all.push(msg); });

    await bus.publish(makeMessage('telegram'));
    await bus.publish(makeMessage('discord'));
    assert.equal(all.length, 2);
  });

  it('should handle multiple subscribers per platform', async () => {
    const a: BotMessage[] = [];
    const b: BotMessage[] = [];
    bus.subscribe('telegram', async (msg) => { a.push(msg); });
    bus.subscribe('telegram', async (msg) => { b.push(msg); });

    await bus.publish(makeMessage('telegram'));
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });

  it('should unsubscribe correctly', async () => {
    const received: BotMessage[] = [];
    const handler = async (msg: BotMessage) => { received.push(msg); };
    bus.subscribe('telegram', handler);

    await bus.publish(makeMessage('telegram'));
    assert.equal(received.length, 1);

    bus.unsubscribe('telegram', handler);
    await bus.publish(makeMessage('telegram'));
    assert.equal(received.length, 1); // no new messages
  });

  it('should handle handler errors without crashing', async () => {
    const good: BotMessage[] = [];
    bus.subscribe('telegram', async () => { throw new Error('handler boom'); });
    bus.subscribe('telegram', async (msg) => { good.push(msg); });

    // Should not throw
    await bus.publish(makeMessage('telegram'));
    assert.equal(good.length, 1);
  });

  it('should emit message events on the EventEmitter', async () => {
    const events: BotMessage[] = [];
    bus.on('message', (msg: BotMessage) => events.push(msg));

    await bus.publish(makeMessage('telegram'));
    assert.equal(events.length, 1);
  });

  it('should emit platform-specific events', async () => {
    const tgEvents: BotMessage[] = [];
    bus.on('message:telegram', (msg: BotMessage) => tgEvents.push(msg));

    await bus.publish(makeMessage('telegram'));
    await bus.publish(makeMessage('discord'));
    assert.equal(tgEvents.length, 1);
  });

  it('should clear all handlers', async () => {
    const received: BotMessage[] = [];
    bus.subscribe('telegram', async (msg) => { received.push(msg); });
    bus.subscribeAll(async (msg) => { received.push(msg); });

    bus.clear();
    await bus.publish(makeMessage('telegram'));
    assert.equal(received.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHANNEL MANAGER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ChannelManager', () => {
  let testDir: string;
  let cm: ChannelManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `openclaude-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    cm = new ChannelManager(testDir);
  });

  afterEach(() => {
    const configPath = join(testDir, 'channels.json');
    if (existsSync(configPath)) unlinkSync(configPath);
  });

  it('should start with empty registry', () => {
    assert.deepEqual(cm.listChannels(), []);
  });

  it('should add a telegram channel', () => {
    const ch = cm.addChannel({
      id: 'tg-1',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    assert.equal(ch.id, 'tg-1');
    assert.equal(ch.platform, 'telegram');
    assert.ok(ch.createdAt);
  });

  it('should add a discord channel', () => {
    cm.addChannel({
      id: 'dc-1',
      platform: 'discord',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    assert.equal(cm.listChannels().length, 1);
    assert.equal(cm.listChannels()[0].platform, 'discord');
  });

  it('should reject duplicate channel IDs', () => {
    cm.addChannel({
      id: 'dup',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    assert.throws(() => cm.addChannel({
      id: 'dup',
      platform: 'discord',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    }), /already exists/);
  });

  it('should remove a channel', () => {
    cm.addChannel({
      id: 'rm-1',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    assert.equal(cm.removeChannel('rm-1'), true);
    assert.deepEqual(cm.listChannels(), []);
  });

  it('should return false when removing non-existent channel', () => {
    assert.equal(cm.removeChannel('nope'), false);
  });

  it('should configure channel updates', () => {
    cm.addChannel({
      id: 'cfg-1',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    const updated = cm.configureChannel('cfg-1', { name: 'My Channel', enabled: false });
    assert.equal(updated.name, 'My Channel');
    assert.equal(updated.enabled, false);
    assert.ok(updated.updatedAt);
  });

  it('should reject configure on non-existent channel', () => {
    assert.throws(() => cm.configureChannel('ghost', { name: 'nope' }), /not found/);
  });

  it('should filter by platform', () => {
    cm.addChannel({
      id: 'tg-f',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    cm.addChannel({
      id: 'dc-f',
      platform: 'discord',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    assert.equal(cm.listChannels('telegram').length, 1);
    assert.equal(cm.listChannels('discord').length, 1);
    assert.equal(cm.listChannels().length, 2);
  });

  it('should get channel by ID', () => {
    cm.addChannel({
      id: 'get-1',
      platform: 'telegram',
      enabled: true,
      allowFrom: ['user-a'],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: { key: 'value' },
    });
    const ch = cm.getChannel('get-1');
    assert.ok(ch);
    assert.deepEqual(ch!.allowFrom, ['user-a']);
    assert.deepEqual(ch!.metadata, { key: 'value' });
  });

  it('should enable/disable channels', () => {
    cm.addChannel({
      id: 'toggle-1',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    cm.setEnabled('toggle-1', false);
    assert.equal(cm.getChannel('toggle-1')!.enabled, false);
    cm.setEnabled('toggle-1', true);
    assert.equal(cm.getChannel('toggle-1')!.enabled, true);
  });

  it('should persist to disk', () => {
    cm.addChannel({
      id: 'persist-1',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    const configPath = join(testDir, 'channels.json');
    assert.ok(existsSync(configPath));

    // Load from disk
    const cm2 = new ChannelManager(testDir);
    assert.equal(cm2.listChannels().length, 1);
    assert.equal(cm2.getChannel('persist-1')!.platform, 'telegram');
  });

  it('should emit events on add/remove/update', () => {
    const events: string[] = [];
    cm.on('channel:added', () => events.push('added'));
    cm.on('channel:removed', () => events.push('removed'));
    cm.on('channel:updated', () => events.push('updated'));

    cm.addChannel({
      id: 'evt-1',
      platform: 'telegram',
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    cm.configureChannel('evt-1', { name: 'test' });
    cm.removeChannel('evt-1');

    assert.deepEqual(events, ['added', 'updated', 'removed']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOT GATEWAY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('BotGateway', () => {
  it('should create with config', () => {
    const gw = new BotGateway({
      telegram: { enabled: false, token: '' },
      discord: { enabled: false, token: '' },
    });
    assert.ok(gw);
    assert.ok(gw.getMessageBus());
  });

  it('should return empty statuses when no adapters', () => {
    const gw = new BotGateway({});
    assert.deepEqual(gw.getAllStatuses(), {});
  });

  it('should allow adding adapters dynamically', async () => {
    const gw = new BotGateway({});
    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();

    await gw.addAdapter('test-1', adapter);
    const statuses = gw.getAllStatuses();
    assert.ok(statuses['test-1']);
    assert.equal(statuses['test-1'].type, 'test');
    assert.equal(statuses['test-1'].connected, true);

    await gw.shutdown('test');
  });

  it('should reject duplicate adapter names', async () => {
    const gw = new BotGateway({});
    const a1 = new TestAdapter({ enabled: true });
    const a2 = new TestAdapter({ enabled: true });
    await a1.initialize();
    await a2.initialize();

    await gw.addAdapter('dup', a1);
    await assert.rejects(() => gw.addAdapter('dup', a2), /already registered/);

    await gw.shutdown('test');
  });

  it('should remove adapters', async () => {
    const gw = new BotGateway({});
    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();

    await gw.addAdapter('removable', adapter);
    assert.ok(gw.getAdapter('removable'));

    await gw.removeAdapter('removable');
    assert.equal(gw.getAdapter('removable'), undefined);

    await gw.shutdown('test');
  });

  it('should route messages through onMessage handler', async () => {
    const gw = new BotGateway({});
    const received: BotMessage[] = [];
    gw.onMessage(async (msg) => { received.push(msg); });

    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();
    await gw.addAdapter('router-test', adapter);

    adapter.simulateMessage('routed message');
    // Give async event flow time to propagate through bus → handler
    await Bun.sleep(50);

    assert.equal(received.length, 1);
    assert.equal(received[0].content, 'routed message');

    await gw.shutdown('test');
  });

  it('should send messages through adapters', async () => {
    const gw = new BotGateway({});
    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();
    await gw.addAdapter('sender', adapter);

    await gw.sendMessage('sender', 'user-1', 'hello from gateway');
    assert.equal(adapter.sentMessages.length, 1);
    assert.equal(adapter.sentMessages[0].content, 'hello from gateway');

    await gw.shutdown('test');
  });

  it('should throw when sending through unknown adapter', async () => {
    const gw = new BotGateway({});
    await assert.rejects(
      () => gw.sendMessage('nonexistent', 'user', 'hi'),
      /No adapter/,
    );
  });

  it('should shutdown cleanly', async () => {
    const gw = new BotGateway({});
    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();
    await gw.addAdapter('shutdown-test', adapter);

    await gw.shutdown('test');
    assert.deepEqual(gw.getAllStatuses(), {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH REPORT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('HealthReport', () => {
  it('should report ok when all adapters connected', async () => {
    const gw = new BotGateway({});
    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();
    await gw.addAdapter('healthy', adapter);

    const startedAt = new Date(Date.now() - 60_000); // 1 min ago
    const report = buildHealthReport(gw, startedAt);

    assert.equal(report.status, 'ok');
    assert.ok(report.uptime > 0);
    assert.ok(report.uptimeHuman);
    assert.ok(report.adapters['healthy']);
    assert.equal(report.adapters['healthy'].connected, true);

    await gw.shutdown('test');
  });

  it('should report degraded when adapter disconnected', async () => {
    const gw = new BotGateway({});
    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();
    await gw.addAdapter('flaky', adapter);
    await adapter.stop(); // disconnect it

    const startedAt = new Date();
    const report = buildHealthReport(gw, startedAt);

    assert.equal(report.status, 'degraded');
    assert.equal(report.adapters['flaky'].connected, false);

    await gw.shutdown('test');
  });

  it('should format uptime correctly', async () => {
    const gw = new BotGateway({});
    const adapter = new TestAdapter({ enabled: true });
    await adapter.initialize();
    await gw.addAdapter('uptime-test', adapter);

    const startedAt = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)); // 2d 3h
    const report = buildHealthReport(gw, startedAt);

    assert.ok(report.uptimeHuman.includes('d'));
    assert.ok(report.uptimeHuman.includes('h'));

    await gw.shutdown('test');
  });

  it('should include timestamp', async () => {
    const gw = new BotGateway({});
    const report = buildHealthReport(gw, new Date());
    assert.ok(report.timestamp);
    // Should be valid ISO string
    assert.ok(!isNaN(Date.parse(report.timestamp)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOT TOOL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('BotTool', () => {
  it('should export correct tool name', () => {
    assert.equal(BOT_TOOL_NAME, 'BotManager');
  });

  it('should have a description', () => {
    assert.ok(DESCRIPTION.length > 100);
    assert.ok(DESCRIPTION.includes('Discord'));
    assert.ok(DESCRIPTION.includes('Telegram'));
  });

  it('should render status action', () => {
    const msg = renderToolUseMessage({ action: 'status' });
    assert.ok(msg.includes('status'));
  });

  it('should render channels list action', () => {
    const msg = renderToolUseMessage({ action: 'channels list' });
    assert.ok(msg.includes('channels list'));
  });

  it('should render send action with details', () => {
    const msg = renderToolUseMessage({
      action: 'send',
      platform: 'telegram',
      userId: 'user-123',
      message: 'Hello!',
    });
    assert.ok(msg.includes('telegram'));
    assert.ok(msg.includes('user-123'));
    assert.ok(msg.includes('Hello!'));
  });

  it('should render channels add action with details', () => {
    const msg = renderToolUseMessage({
      action: 'channels add',
      channelId: 'my-chat',
      platform: 'discord',
    });
    assert.ok(msg.includes('channels add'));
    assert.ok(msg.includes('my-chat'));
    assert.ok(msg.includes('discord'));
  });

  it('should return correct summaries for each action', () => {
    assert.equal(getToolUseSummary({ action: 'status' }), 'Checking bot gateway status');
    assert.equal(getToolUseSummary({ action: 'channels list' }), 'Listing bot channels');
    assert.equal(
      getToolUseSummary({ action: 'channels add', channelId: 'x', platform: 'telegram' }),
      'Adding channel x (telegram)',
    );
    assert.equal(getToolUseSummary({ action: 'channels remove', channelId: 'y' }), 'Removing channel y');
    assert.equal(getToolUseSummary({ action: 'channels enable', channelId: 'z' }), 'Enabling channel z');
    assert.equal(getToolUseSummary({ action: 'channels disable', channelId: 'w' }), 'Disabling channel w');
    assert.equal(getToolUseSummary({ action: 'send', platform: 'discord' }), 'Sending message via discord');
  });

  it('should render success result message', () => {
    const msg = renderToolResultMessage({ success: true, output: 'All good' });
    assert.equal(msg, 'All good');
  });

  it('should render error result message', () => {
    const msg = renderToolResultMessage({ success: false, output: 'Something broke' });
    assert.ok(msg.includes('error'));
    assert.ok(msg.includes('Something broke'));
  });

  it('should have correct input schema fields', () => {
    // Verify the tool was built correctly
    assert.ok(BotTool);
    assert.equal(BotTool.name, 'BotManager');
  });

  it('should handle unknown action gracefully', async () => {
    const iterator = BotTool.call(
      { action: 'nonexistent' as any },
      {} as any,
    );
    const result = await iterator.next();
    assert.equal(result.value.type, 'result');
    assert.equal((result.value.data as any).success, false);
    assert.ok((result.value.data as any).output.includes('Unknown action'));
  });

  it('should handle channels add missing params', async () => {
    const iterator = BotTool.call(
      { action: 'channels add' },
      {} as any,
    );
    const result = await iterator.next();
    assert.equal(result.value.type, 'result');
    assert.equal((result.value.data as any).success, false);
    assert.ok((result.value.data as any).output.includes('requires'));
  });

  it('should handle send missing params', async () => {
    const iterator = BotTool.call(
      { action: 'send', platform: 'telegram' },
      {} as any,
    );
    const result = await iterator.next();
    assert.equal(result.value.type, 'result');
    assert.equal((result.value.data as any).success, false);
    assert.ok((result.value.data as any).output.includes('requires'));
  });
});
