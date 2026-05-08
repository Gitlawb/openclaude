import { describe, expect, it, beforeEach, mock } from 'bun:test';

const mockKill  = mock(() => true);
const mockOn    = mock((_evt: string, _cb: (...a: unknown[]) => void) => {});
const mockSpawn = mock(() => ({ pid: 99, killed: false, kill: mockKill, on: mockOn }));

mock.module('node:child_process', () => ({ spawn: mockSpawn }));

import { ServerManager, buildServerEnv } from '../src/server-manager.js';
import type { PluginSettings } from '../src/types.js';

const settings: PluginSettings = {
  port: 7777,
  serverBinaryPath: '/repo/dist/cli.mjs',
  tokenPath: '~/.openclaude/server-token',
  autoStartServer: true,
  preset: 'balanced',
  provider: { type: 'anthropic' },
  vaultPathOverride: '',
  braveApiKey: '',
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

const BASE_SETTINGS: PluginSettings = {
  port: 7777,
  serverBinaryPath: '/fake/cli.mjs',
  tokenPath: '~/.openclaude/server-token',
  autoStartServer: true,
  preset: 'balanced',
  provider: { type: 'anthropic' },
  vaultPathOverride: '',
  braveApiKey: '',
};

describe('buildServerEnv', () => {
  it('returns undefined for anthropic provider (inherit OS env)', () => {
    expect(buildServerEnv({ ...BASE_SETTINGS, provider: { type: 'anthropic' } })).toBeUndefined();
  });

  it('sets OPENAI_BASE_URL and OPENAI_API_KEY for ollama', () => {
    const env = buildServerEnv({
      ...BASE_SETTINGS,
      provider: {
        type: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'ollama',
        model: 'qwen3-vl:235b-cloud',
      },
    });
    expect(env).toBeDefined();
    expect(env!.OPENAI_BASE_URL).toBe('http://localhost:11434/v1');
    expect(env!.OPENAI_API_KEY).toBe('ollama');
    expect(env!.OPENCLAUDE_MODEL).toBe('qwen3-vl:235b-cloud');
    expect(env!.CLAUDE_CODE_USE_OPENAI).toBe('1');
  });

  it('sets OPENAI vars for openai provider type', () => {
    const env = buildServerEnv({
      ...BASE_SETTINGS,
      provider: {
        type: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: 'gsk_test',
        model: 'llama-3.3-70b',
      },
    });
    expect(env!.OPENAI_BASE_URL).toBe('https://api.groq.com/openai/v1');
    expect(env!.CLAUDE_CODE_USE_OPENAI).toBe('1');
  });

  it('passes BRAVE_API_KEY if braveApiKey is set', () => {
    const env = buildServerEnv({
      ...BASE_SETTINGS,
      braveApiKey: 'BSAtest123',
      provider: { type: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama' },
    });
    expect(env!.BRAVE_API_KEY).toBe('BSAtest123');
  });
});
