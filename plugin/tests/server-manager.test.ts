import { describe, expect, it, beforeEach, mock } from 'bun:test';

const mockKill  = mock(() => true);
const mockOn    = mock((_evt: string, _cb: (...a: unknown[]) => void) => {});
const mockSpawn = mock(() => ({ pid: 99, killed: false, kill: mockKill, on: mockOn }));

mock.module('node:child_process', () => ({ spawn: mockSpawn }));

import { ServerManager } from '../src/server-manager.js';
import type { PluginSettings } from '../src/types.js';

const settings: PluginSettings = {
  port: 7777,
  serverBinaryPath: '/repo/dist/cli.mjs',
  tokenPath: '~/.openclaude/server-token',
  autoStartServer: true,
  preset: 'balanced',
};

const mockApi = {
  health: mock(async () => ({ status: 'ok' as const, version: '0.1.0', uptime_ms: 1 })),
  connect: mock(async () => {}),
};

describe('ServerManager', () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockKill.mockClear();
    mockOn.mockClear();
    mockApi.health.mockClear();
  });

  it('isRunning() is false before start()', () => {
    const mgr = new ServerManager(settings, mockApi as never);
    expect(mgr.isRunning()).toBe(false);
  });

  it('start() spawns a child process', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('start() uses "node" as command for .mjs binary', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    const [cmd] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('node');
  });

  it('start() passes serve + port args', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain('serve');
    expect(args).toContain('--port');
    expect(args).toContain('7777');
  });

  it('isRunning() is true after start()', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    expect(mgr.isRunning()).toBe(true);
  });

  it('stop() kills the process', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    mgr.stop();
    expect(mockKill).toHaveBeenCalledTimes(1);
  });

  it('isRunning() is false after stop()', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    mgr.stop();
    expect(mgr.isRunning()).toBe(false);
  });

  it('start() is idempotent — does not double-spawn', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    await mgr.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
