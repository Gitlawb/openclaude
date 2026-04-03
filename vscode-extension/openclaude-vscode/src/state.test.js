const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  chooseLaunchWorkspace,
  describeProviderState,
  findCommandPath,
  parseProfileFile,
  resolveCommandCheckPath,
} = require('./state');

test('chooseLaunchWorkspace prefers the active workspace folder', () => {
  assert.deepEqual(
    chooseLaunchWorkspace({
      activeWorkspacePath: '/repo-b',
      workspacePaths: ['/repo-a', '/repo-b'],
    }),
    { workspacePath: '/repo-b', source: 'active-workspace' },
  );
});

test('chooseLaunchWorkspace falls back to the first workspace folder', () => {
  assert.deepEqual(
    chooseLaunchWorkspace({
      activeWorkspacePath: null,
      workspacePaths: ['/repo-a', '/repo-b'],
    }),
    { workspacePath: '/repo-a', source: 'first-workspace' },
  );
});

test('parseProfileFile returns null for invalid JSON', () => {
  assert.equal(parseProfileFile('{bad json}'), null);
});

test('parseProfileFile returns null for unsupported profiles', () => {
  assert.equal(
    parseProfileFile(
      JSON.stringify({
        profile: 'lmstudio',
        env: {},
        createdAt: '2026-04-03T00:00:00.000Z',
      }),
    ),
    null,
  );
});

test('parseProfileFile returns null when env is missing', () => {
  assert.equal(
    parseProfileFile(
      JSON.stringify({
        profile: 'openai',
        createdAt: '2026-04-03T00:00:00.000Z',
      }),
    ),
    null,
  );
});

test('parseProfileFile returns null when env is not an object', () => {
  assert.equal(
    parseProfileFile(
      JSON.stringify({
        profile: 'openai',
        env: ['OPENAI_MODEL=gpt-4o'],
        createdAt: '2026-04-03T00:00:00.000Z',
      }),
    ),
    null,
  );
});

test('resolveCommandCheckPath resolves workspace-relative executables', () => {
  assert.equal(
    resolveCommandCheckPath('./node_modules/.bin/openclaude', '/repo'),
    require('node:path').resolve('/repo', './node_modules/.bin/openclaude'),
  );
});

test('resolveCommandCheckPath leaves bare commands alone', () => {
  assert.equal(resolveCommandCheckPath('openclaude', '/repo'), null);
});

test('findCommandPath treats shell-like input as a literal executable name', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaude-command-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const commandName = process.platform === 'win32'
    ? 'openclaude & whoami'
    : 'openclaude && whoami';
  const executableName = process.platform === 'win32'
    ? `${commandName}.cmd`
    : commandName;
  const executablePath = path.join(tempDir, executableName);

  fs.writeFileSync(executablePath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
  if (process.platform !== 'win32') {
    fs.chmodSync(executablePath, 0o755);
  }

  assert.equal(
    findCommandPath(commandName, {
      cwd: null,
      env: {
        PATH: tempDir,
        PATHEXT: '.CMD;.EXE',
      },
      platform: process.platform,
    }),
    executablePath,
  );
});

test('describeProviderState uses saved profile when present', () => {
  assert.deepEqual(
    describeProviderState({
      shimEnabled: false,
      env: {},
      profile: {
        profile: 'ollama',
        env: { OPENAI_MODEL: 'llama3.2' },
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    }),
    {
      label: 'Ollama',
      detail: 'llama3.2',
      source: 'profile',
    },
  );
});

test('describeProviderState reports LM Studio from openai profile base url', () => {
  assert.deepEqual(
    describeProviderState({
      shimEnabled: false,
      env: {},
      profile: {
        profile: 'openai',
        env: {
          OPENAI_BASE_URL: 'http://localhost:1234/v1',
          OPENAI_MODEL: 'qwen2.5-coder',
        },
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    }),
    {
      label: 'LM Studio',
      detail: 'qwen2.5-coder',
      source: 'profile',
    },
  );
});

test('describeProviderState reports environment-backed provider details', () => {
  assert.deepEqual(
    describeProviderState({
      shimEnabled: false,
      env: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_MODEL: 'llama3.2:3b',
      },
      profile: null,
    }),
    {
      label: 'Ollama',
      detail: 'llama3.2:3b',
      source: 'env',
    },
  );
});

test('describeProviderState reports unknown when only the shim is enabled', () => {
  assert.deepEqual(
    describeProviderState({
      shimEnabled: true,
      env: {},
      profile: null,
    }),
    {
      label: 'OpenAI-compatible (provider unknown)',
      detail: 'launch shim enabled',
      source: 'shim',
    },
  );
});

test('describeProviderState stays honest when nothing is configured', () => {
  assert.deepEqual(
    describeProviderState({
      shimEnabled: false,
      env: {},
      profile: null,
    }),
    {
      label: 'Unknown',
      detail: 'no saved profile or provider env detected',
      source: 'unknown',
    },
  );
});
