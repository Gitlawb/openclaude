import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import * as fsPromises from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realEnv from './env.js'
import * as realEnvUtils from './envUtils.js'
import * as realExecFileNoThrow from './execFileNoThrow.js'

const originalEnv = { ...process.env }
const originalMacro = (globalThis as Record<string, unknown>).MACRO

// Snapshot the real execFileNoThrow module BEFORE installing the mock below.
// bun live-updates the `realExecFileNoThrow` namespace to point at the mock once
// mock.module runs, so delegating through the namespace inside the override
// would call the override itself and recurse infinitely. A plain-object copy
// taken now captures the genuine implementations.
const realExecFileNoThrowModule = { ...realExecFileNoThrow }

// The `cleanupNpmInstallations` test needs execFileNoThrowWithCwd to simulate a
// failed `npm uninstall` (E404). bun's mock.module is process-wide and
// re-mocking the module back to the real implementation in afterEach does NOT
// reliably undo it, so a naive `mock.module(...)` set inside the test can leak
// into later test files that shell out for real (e.g. `git worktree add`),
// making them fail with a bogus "npm ERR! code E404". Install the override once
// at module load and gate it on this flag so the persisted mock transparently
// falls through to the real implementation whenever the flag is off.
let simulateNpmUninstallFailure = false

mock.module('./execFileNoThrow.js', () => ({
  ...realExecFileNoThrowModule,
  execFileNoThrowWithCwd: (
    ...args: Parameters<typeof realExecFileNoThrow.execFileNoThrowWithCwd>
  ) =>
    simulateNpmUninstallFailure
      ? Promise.resolve({ stdout: '', stderr: 'npm ERR! code E404', code: 1 })
      : realExecFileNoThrowModule.execFileNoThrowWithCwd(...args),
}))

beforeEach(async () => {
  await acquireSharedMutationLock('utils/openclaudeInstallSurfaces.test.ts')
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    if (originalMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    }
    simulateNpmUninstallFailure = false
    mock.restore()
    mock.module('../utils/env.js', () => realEnv)
    mock.module('./envUtils.js', () => realEnvUtils)
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFreshInstallCommand() {
  return import(`../commands/install.tsx?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshInstaller() {
  return import(`./nativeInstaller/installer.ts?ts=${Date.now()}-${Math.random()}`)
}

async function mockEnvPlatform(platform: 'darwin' | 'win32') {
  const actualEnvModule = await import(`./env.js?ts=${Date.now()}-${Math.random()}`)
  mock.module('../utils/env.js', () => ({
    ...actualEnvModule,
    env: {
      ...actualEnvModule.env,
      platform,
    },
  }))
}

test('install command displays ~/.local/bin/openclaude on non-Windows', async () => {
  await mockEnvPlatform('darwin')

  const { getInstallationPath } = await importFreshInstallCommand()

  expect(getInstallationPath()).toBe('~/.local/bin/openclaude')
})

test('install command displays openclaude.exe path on Windows', async () => {
  await mockEnvPlatform('win32')

  const { getInstallationPath } = await importFreshInstallCommand()

  expect(getInstallationPath()).toBe(
    join(homedir(), '.local', 'bin', 'openclaude.exe').replace(/\//g, '\\'),
  )
})

test('cleanupNpmInstallations removes both openclaude and legacy claude local install dirs', async () => {
  const removedPaths: string[] = []
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@gitlawb/openclaude',
  }
  process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.openclaude')

  mock.module('fs/promises', () => ({
    ...fsPromises,
    rm: async (path: string) => {
      removedPaths.push(path)
    },
  }))

  simulateNpmUninstallFailure = true

  mock.module('./envUtils.js', () => ({
    ...realEnvUtils,
    getClaudeConfigHomeDir: () => join(homedir(), '.openclaude'),
  }))

  const { cleanupNpmInstallations } = await importFreshInstaller()
  await cleanupNpmInstallations()

  expect(removedPaths).toContain(join(homedir(), '.openclaude', 'local'))
  expect(removedPaths).toContain(join(homedir(), '.claude', 'local'))
})
