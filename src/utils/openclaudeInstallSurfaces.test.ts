import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import * as fsPromises from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
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
let simulateNpmUninstallEnotempty = false
let fakeNpmPrefix: string | undefined
const npmUninstallPackages: string[] = []

mock.module('./execFileNoThrow.js', () => ({
  ...realExecFileNoThrowModule,
  execFileNoThrowWithCwd: (
    ...args: Parameters<typeof realExecFileNoThrow.execFileNoThrowWithCwd>
  ) => {
    const [command, commandArgs] = args
    if (command === 'npm' && Array.isArray(commandArgs)) {
      if (
        fakeNpmPrefix &&
        commandArgs[0] === 'config' &&
        commandArgs[1] === 'get' &&
        commandArgs[2] === 'prefix'
      ) {
        return Promise.resolve({ stdout: fakeNpmPrefix, stderr: '', code: 0 })
      }

      if (simulateNpmUninstallEnotempty && commandArgs[0] === 'uninstall') {
        npmUninstallPackages.push(String(commandArgs.at(-1)))
        return Promise.resolve({
          stdout: '',
          stderr: 'npm error code ENOTEMPTY',
          code: 1,
        })
      }

      if (simulateNpmUninstallFailure && commandArgs[0] === 'uninstall') {
        npmUninstallPackages.push(String(commandArgs.at(-1)))
        return Promise.resolve({
          stdout: '',
          stderr: 'npm ERR! code E404',
          code: 1,
        })
      }
    }

    return realExecFileNoThrowModule.execFileNoThrowWithCwd(...args)
  },
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
    simulateNpmUninstallEnotempty = false
    fakeNpmPrefix = undefined
    npmUninstallPackages.length = 0
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

async function importFreshProtocolRegistration() {
  return import(`./deepLink/registerProtocol.ts?ts=${Date.now()}-${Math.random()}`)
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

test('native installer uses openclaude launcher for OpenClaude package', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@gitlawb/openclaude',
  }

  const { getBinaryName, getExecutableName } = await importFreshInstaller()

  expect(getBinaryName('linux-x64')).toBe('claude')
  expect(getExecutableName('linux-x64')).toBe('openclaude')
  expect(getExecutableName('win32-x64')).toBe('openclaude.exe')
})

test('native installer preserves claude launcher for Anthropic package', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@anthropic-ai/claude-code',
  }

  const { getExecutableName } = await importFreshInstaller()

  expect(getExecutableName('linux-x64')).toBe('claude')
  expect(getExecutableName('win32-x64')).toBe('claude.exe')
})

test('deep-link protocol resolver uses openclaude launcher for OpenClaude package', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@gitlawb/openclaude',
  }

  const { getProtocolBinaryName } = await importFreshProtocolRegistration()

  expect(getProtocolBinaryName('linux')).toBe('openclaude')
  expect(getProtocolBinaryName('win32')).toBe('openclaude.exe')
})

test('install command repairs launcher after npm cleanup before final check', async () => {
  const calls: string[] = []
  let repairCompleted = false

  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}

  mock.module('../utils/nativeInstaller/index.js', () => ({
    installLatest: async () => {
      calls.push('installLatest')
      return { latestVersion: '1.2.3', wasUpdated: true, lockFailed: false }
    },
    cleanupNpmInstallations: async () => {
      calls.push('cleanupNpmInstallations')
      return { removed: 1, errors: [], warnings: [] }
    },
    repairNativeLauncher: async (version: string) => {
      calls.push('repairNativeLauncher:' + version)
      await Bun.sleep(1)
      repairCompleted = true
    },
    checkInstall: async (setup: boolean) => {
      calls.push('checkInstall:' + setup + ':' + repairCompleted)
      return []
    },
    cleanupShellAliases: async () => {
      calls.push('cleanupShellAliases')
      return []
    },
  }))

  const [{ Install }, { render }] = await Promise.all([
    importFreshInstallCommand(),
    import(`../ink.js?ts=${Date.now()}-${Math.random()}`),
  ])
  const done = new Promise<void>((resolve, reject) => {
    void render(
      createElement(Install, {
        target: '1.2.3',
        onDone: (result: string) => {
          try {
            expect(result).toBe('OpenClaude installation completed successfully')
            resolve()
          } catch (error) {
            reject(error)
          }
        },
      }),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        patchConsole: false,
      },
    ).catch(reject)
  })

  try {
    await done
  } finally {
    stdin.end()
    stdout.end()
  }
  expect(calls).toEqual([
    'installLatest',
    'cleanupNpmInstallations',
    'repairNativeLauncher:1.2.3',
    'checkInstall:true:true',
    'cleanupShellAliases',
  ])
})

test('cleanupNpmInstallations removes only openclaude local install dir', async () => {
  const removedPaths: string[] = []
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@gitlawb/openclaude',
  }
  process.env.OPENCLAUDE_CONFIG_DIR = join(homedir(), '.openclaude')
  delete process.env.CLAUDE_CONFIG_DIR

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
  expect(removedPaths).not.toContain(join(homedir(), '.claude', 'local'))
  expect(npmUninstallPackages).toContain('@gitlawb/openclaude')
  expect(npmUninstallPackages).not.toContain('@anthropic-ai/claude-code')
})

test('cleanupNpmInstallations manual fallback removes openclaude npm shim', async () => {
  await mockEnvPlatform('darwin')

  const testHome = join(process.cwd(), 'work', 'openclaude-install-home-test')
  const npmPrefix = join(testHome, '.npm-global')
  const shimPath = join(npmPrefix, 'bin', 'openclaude')
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@gitlawb/openclaude',
  }
  process.env.HOME = testHome
  process.env.USERPROFILE = testHome
  process.env.OPENCLAUDE_CONFIG_DIR = join(testHome, '.openclaude')
  delete process.env.CLAUDE_CONFIG_DIR
  fakeNpmPrefix = npmPrefix
  simulateNpmUninstallEnotempty = true

  await fsPromises.mkdir(join(npmPrefix, 'bin'), { recursive: true })
  await fsPromises.writeFile(shimPath, 'stale npm shim')

  try {
    const { cleanupNpmInstallations } = await importFreshInstaller()
    await cleanupNpmInstallations()

    await expect(fsPromises.stat(shimPath)).rejects.toThrow()
  } finally {
    await fsPromises.rm(testHome, { recursive: true, force: true })
  }
})
