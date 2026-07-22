/**
 * Regression tests for issue #402 — NODE_OPTIONS heap cap
 * Closes: Gitlawb/openclaude#402 — JavaScript heap OOM during large tasks
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from '@commander-js/extra-typings'
import { applyMainOptions } from '../mainCliOptions.js'
import {
  applyLoadedEnvFileValues,
  loadEnvFile,
} from '../utils/envFile.js'
import {
  applyProviderFlagFromArgs,
  clearRememberedProviderFlagForTests,
  reapplyRememberedProviderFlag,
} from '../utils/providerFlag.js'
import { applyProfileEnvToProcessEnv } from '../utils/providerProfile.js'

type CliMain = typeof import('./cli.js')['main']

let runCliEntrypoint: CliMain

const mockProfileCheckpoint = mock((_checkpoint: string) => {})
const mockPsHandler = mock(async (_args: string[]) => {})
const mockLogsHandler = mock(async (_args: string[]) => {})
const mockAttachHandler = mock(async (_args: string[]) => {})
const mockKillHandler = mock(async (_args: string[]) => {})
const mockHandleBgFlag = mock(async (_args: string[]) => {})
const mockLoadEnvFile = mock((_filePath: string) => ({}))
const mockParseProviderEnvFileArgs = mock((_args: string[]) => ({ paths: [] }))
const mockReapplyRememberedEnvFileValues = mock(() => {})
const mockRememberLoadedEnvFileValues = mock(
  (_values: Record<string, string>) => {},
)
const mockEnableConfigs = mock(() => {})
const mockApplySafeConfigEnvironmentVariables = mock(() => {})
const mockApplyStartupEnvFromProfile = mock(
  async (_input: {
    processEnv: NodeJS.ProcessEnv
    onValidationError: (message: string) => void
  }) => {},
)
const mockGetProviderValidationError = mock(
  async (_env: NodeJS.ProcessEnv) => undefined,
)
const mockEagerLoadSettingsFromArgs = mock((_args: string[]) => ({ ok: true }))
const mockResolveOutOfProcessTeammateProviderFromCliArgs = mock(
  (_args: string[], _settings: unknown) => undefined,
)
const mockApplyAgentProviderOverrideToEnv = mock((_override: unknown) => {})
const mockGetInitialSettings = mock(() => ({}))
const mockRefreshGithubModelsTokenIfNeeded = mock(async () => {})
const mockHydrateGithubModelsTokenFromSecureStorage = mock(() => {})
const mockValidateProviderEnvForStartupOrExit = mock(async () => {})
const mockPrintStartupScreen = mock((_model: string | undefined) => {})
const mockStartCapturingEarlyInput = mock(() => {})
const mockCliMain = mock(async () => {})

const runtimeMocks = [
  mockProfileCheckpoint,
  mockPsHandler,
  mockLogsHandler,
  mockAttachHandler,
  mockKillHandler,
  mockHandleBgFlag,
  mockLoadEnvFile,
  mockParseProviderEnvFileArgs,
  mockReapplyRememberedEnvFileValues,
  mockRememberLoadedEnvFileValues,
  mockEnableConfigs,
  mockApplySafeConfigEnvironmentVariables,
  mockApplyStartupEnvFromProfile,
  mockGetProviderValidationError,
  mockEagerLoadSettingsFromArgs,
  mockResolveOutOfProcessTeammateProviderFromCliArgs,
  mockApplyAgentProviderOverrideToEnv,
  mockGetInitialSettings,
  mockRefreshGithubModelsTokenIfNeeded,
  mockHydrateGithubModelsTokenFromSecureStorage,
  mockValidateProviderEnvForStartupOrExit,
  mockPrintStartupScreen,
  mockStartCapturingEarlyInput,
  mockCliMain,
]

function clearRuntimeMocks() {
  for (const fn of runtimeMocks) {
    fn.mockClear()
  }
}

// Several tests in this file spawn the built CLI (the Node-24 premature-exit
// regression and the live --yolo registration check). `bun test` on a clean
// checkout hasn't produced dist/cli.mjs, so build it once up front — file-level
// so it runs before every describe, not just the one that needs it last.
//
// Rebuild when the artifact is missing OR older than ANY source under src/: a
// stale dist (CI cache, older local build) would otherwise let the --help test
// pass against a build predating the change it exists to catch. Scanning the
// whole tree rather than a hand-listed subset means the check can't drift as
// the CLI's registration moves between files.
beforeAll(async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const repoRoot = path.resolve(import.meta.dir, '../..')
  const srcDir = path.join(repoRoot, 'src')
  const distPath = path.join(repoRoot, 'dist/cli.mjs')
  const distMtime = fs.existsSync(distPath) ? fs.statSync(distPath).mtimeMs : 0
  let newestSource = 0
  // A missing artifact is rebuilt unconditionally, so skip the scan entirely —
  // its answer cannot change the decision.
  if (distMtime === 0) newestSource = Number.POSITIVE_INFINITY
  // src/ also holds plain .js/.mjs sources (e.g. src/commands/*/index.js).
  // Test files are skipped (*.test.*, *.spec.*, __tests__/): they never reach
  // dist/cli.mjs, so editing a test shouldn't force a rebuild before this runs.
  for await (const rel of distMtime === 0
    ? []
    : new Bun.Glob('**/*.{ts,tsx,js,jsx,mjs,cjs}').scan(srcDir)) {
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('__tests__')) continue
    const m = fs.statSync(path.join(srcDir, rel)).mtimeMs
    if (m > newestSource) newestSource = m
  }
  // Build inputs outside src/ also determine the bundle. scripts/build.ts holds
  // the featureFlags map these tests reason about (SSH_REMOTE/DIRECT_CONNECT
  // compile out), so editing it must invalidate dist too — otherwise the --help
  // assertion below passes against a binary that predates the change.
  for (const rel of ['scripts/build.ts', 'package.json']) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue
    const m = fs.statSync(abs).mtimeMs
    if (m > newestSource) newestSource = m
  }
  if (distMtime < newestSource) {
    // Cap the spawn itself: the hook's 300s budget is a runner-level timeout and
    // cannot preempt a wedged synchronous spawn.
    const built = Bun.spawnSync(['bun', 'run', 'build'], {
      cwd: repoRoot,
      timeout: 240_000,
    })
    if (built.exitCode !== 0) {
      throw new Error(
        `on-demand \`bun run build\` failed (exit ${built.exitCode}):\n` +
          `${built.stdout.toString()}${built.stderr.toString()}`,
      )
    }
  }
}, 300_000)

describe('cli.tsx — NODE_OPTIONS --max-old-space-size (issue #402)', () => {
  const originalNodeOptions = process.env.NODE_OPTIONS

  beforeEach(() => {
    delete process.env.NODE_OPTIONS
  })

  afterEach(() => {
    if (originalNodeOptions !== undefined) {
      process.env.NODE_OPTIONS = originalNodeOptions
    } else {
      delete process.env.NODE_OPTIONS
    }
  })

  it('sets --max-old-space-size=8192 when NODE_OPTIONS is not set', () => {
    // Guard predicate: fires when the flag is absent
    const shouldSetHeapCap = !process.env.NODE_OPTIONS?.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(true)
  })

  it('does not override existing --max-old-space-size=4096', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096 --experimental-vm-modules'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toContain('4096')
  })

  it('does not override existing --max-old-space-size=8192', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=8192'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=8192')
  })

  it('appends --max-old-space-size when NODE_OPTIONS has other flags', () => {
    process.env.NODE_OPTIONS = '--inspect=9229'

    const result = `${process.env.NODE_OPTIONS} --max-old-space-size=8192`
    expect(result).toBe('--inspect=9229 --max-old-space-size=8192')
  })
})

describe('cli.tsx — --provider startup ordering', () => {
  const providerEnvKeys = [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'GEMINI_MODEL',
  ]
  const originalEnv = new Map<string, string | undefined>()
  let tempDir: string

  beforeEach(() => {
    clearRememberedProviderFlagForTests()
    tempDir = mkdtempSync(join(tmpdir(), 'openclaude-cli-env-file-test-'))
    for (const key of providerEnvKeys) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    for (const key of providerEnvKeys) {
      const originalValue = originalEnv.get(key)
      if (originalValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalValue
      }
    }
    originalEnv.clear()
    clearRememberedProviderFlagForTests()
  })

  function writeProviderEnvFile(content: string): string {
    const filePath = join(tempDir, '.env')
    writeFileSync(filePath, content, 'utf-8')
    return filePath
  }

  it('remembers --provider so settings.env reloads cannot clobber it', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()

    const earlyProviderApplyIndex = src.indexOf('applyProviderFlagFromArgs(args')
    const rememberOptionIndex = src.indexOf(
      'rememberForSettingsEnv: true',
      earlyProviderApplyIndex,
    )
    const settingsEnvApplyIndex = src.indexOf(
      'applySafeConfigEnvironmentVariables()',
    )

    expect(earlyProviderApplyIndex).toBeGreaterThanOrEqual(0)
    expect(rememberOptionIndex).toBeGreaterThan(earlyProviderApplyIndex)
    expect(settingsEnvApplyIndex).toBeGreaterThan(earlyProviderApplyIndex)
  })

  it('reapplies remembered --provider after every managed settings env merge', async () => {
    const src = await Bun.file(`${import.meta.dir}/../utils/managedEnv.ts`).text()
    const safeApplyIndex = src.indexOf('export function applySafeConfigEnvironmentVariables')
    const configApplyIndex = src.indexOf('export function applyConfigEnvironmentVariables')
    const safeReapplyIndex = src.indexOf(
      'reapplyRememberedProviderFlag()',
      safeApplyIndex,
    )
    const configReapplyIndex = src.indexOf(
      'reapplyRememberedProviderFlag()',
      configApplyIndex,
    )

    expect(safeReapplyIndex).toBeGreaterThan(safeApplyIndex)
    expect(safeReapplyIndex).toBeLessThan(configApplyIndex)
    expect(configReapplyIndex).toBeGreaterThan(configApplyIndex)
  })

  it('remembers provider env-file values so later managed settings env merges can restore them', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    const envFileImportIndex = src.indexOf('rememberLoadedEnvFileValues')
    const rememberLoadedFileIndex = src.indexOf(
      'rememberLoadedEnvFileValues(loadEnvFile(filePath))',
    )

    expect(envFileImportIndex).toBeGreaterThanOrEqual(0)
    expect(rememberLoadedFileIndex).toBeGreaterThan(envFileImportIndex)
  })

  it('preserves explicit --provider-env-file values through settings and startup profile env merges', () => {
    const filePath = writeProviderEnvFile([
      'CLAUDE_CODE_USE_OPENAI=1',
      'OPENAI_API_KEY=file-key',
      'OPENAI_BASE_URL=https://file.example/v1',
      'OPENAI_MODEL=file-model',
    ].join('\n'))

    const loaded = loadEnvFile(filePath)

    Object.assign(process.env, {
      OPENAI_API_KEY: 'settings-key',
      OPENAI_BASE_URL: 'https://settings.example/v1',
      OPENAI_MODEL: 'settings-model',
    })
    applyLoadedEnvFileValues(loaded)

    applyProfileEnvToProcessEnv(process.env, {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'profile-key',
      OPENAI_BASE_URL: 'https://profile.example/v1',
      OPENAI_MODEL: 'profile-model',
    })
    applyLoadedEnvFileValues(loaded)

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_API_KEY).toBe('file-key')
    expect(process.env.OPENAI_BASE_URL).toBe('https://file.example/v1')
    expect(process.env.OPENAI_MODEL).toBe('file-model')
  })

  it('keeps explicit --provider values ahead of provider env-file reapply checkpoints', () => {
    const filePath = writeProviderEnvFile([
      'CLAUDE_CODE_USE_OPENAI=1',
      'OPENAI_API_KEY=file-key',
      'OPENAI_BASE_URL=https://file.example/v1',
      'OPENAI_MODEL=file-model',
    ].join('\n'))

    const loaded = loadEnvFile(filePath)
    const result = applyProviderFlagFromArgs(
      ['--provider', 'gemini', '--model', 'gemini-2.0-flash'],
      { rememberForSettingsEnv: true },
    )
    expect(result?.error).toBeUndefined()

    applyLoadedEnvFileValues(loaded)
    reapplyRememberedProviderFlag()
    applyLoadedEnvFileValues(loaded)
    reapplyRememberedProviderFlag()

    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_GEMINI).toBe('1')
    expect(process.env.GEMINI_MODEL).toBe('gemini-2.0-flash')
  })

  it('dispatches background session management before config and provider validation', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    const bgManagementIndex = src.indexOf("args[0] === 'ps'")
    const configEnableIndex = src.indexOf('enableConfigs()')
    const providerValidationIndex = src.indexOf(
      'await validateProviderEnvForStartupOrExit()',
    )

    expect(bgManagementIndex).toBeGreaterThanOrEqual(0)
    expect(configEnableIndex).toBeGreaterThanOrEqual(0)
    expect(providerValidationIndex).toBeGreaterThanOrEqual(0)
    expect(bgManagementIndex).toBeLessThan(configEnableIndex)
    expect(bgManagementIndex).toBeLessThan(providerValidationIndex)
  })

  it('keeps background spawn after profile routing but before provider validation', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    const profileApplyIndex = src.indexOf('await applyStartupEnvFromProfile')
    const bgFlagIndex = src.indexOf("optionArgs.includes('--bg')")
    const providerValidationIndex = src.indexOf(
      'await validateProviderEnvForStartupOrExit()',
    )

    expect(profileApplyIndex).toBeGreaterThanOrEqual(0)
    expect(bgFlagIndex).toBeGreaterThanOrEqual(0)
    expect(providerValidationIndex).toBeGreaterThanOrEqual(0)
    expect(bgFlagIndex).toBeGreaterThan(profileApplyIndex)
    expect(bgFlagIndex).toBeLessThan(providerValidationIndex)
  })

})

const mockImporters = {
  startupProfiler: async () => ({
    profileCheckpoint: mockProfileCheckpoint,
  }),
  bg: async () => ({
    psHandler: mockPsHandler,
    logsHandler: mockLogsHandler,
    attachHandler: mockAttachHandler,
    killHandler: mockKillHandler,
    handleBgFlag: mockHandleBgFlag,
  }),
  envFile: async () => ({
    loadEnvFile: mockLoadEnvFile,
    parseProviderEnvFileArgs: mockParseProviderEnvFileArgs,
    reapplyRememberedEnvFileValues: mockReapplyRememberedEnvFileValues,
    rememberLoadedEnvFileValues: mockRememberLoadedEnvFileValues,
  }),
  config: async () => ({
    enableConfigs: mockEnableConfigs,
  }),
  managedEnv: async () => ({
    applySafeConfigEnvironmentVariables:
      mockApplySafeConfigEnvironmentVariables,
  }),
  providerProfile: async () => ({
    applyStartupEnvFromProfile: mockApplyStartupEnvFromProfile,
  }),
  providerValidation: async () => ({
    getProviderValidationError: mockGetProviderValidationError,
    validateProviderEnvForStartupOrExit:
      mockValidateProviderEnvForStartupOrExit,
  }),
  flagSettings: async () => ({
    eagerLoadSettingsFromArgs: mockEagerLoadSettingsFromArgs,
  }),
  agentRouting: async () => ({
    applyAgentProviderOverrideToEnv: mockApplyAgentProviderOverrideToEnv,
    resolveOutOfProcessTeammateProviderFromCliArgs:
      mockResolveOutOfProcessTeammateProviderFromCliArgs,
  }),
  settings: async () => ({
    getInitialSettings: mockGetInitialSettings,
  }),
  githubModelsCredentials: async () => ({
    hydrateGithubModelsTokenFromSecureStorage:
      mockHydrateGithubModelsTokenFromSecureStorage,
    refreshGithubModelsTokenIfNeeded: mockRefreshGithubModelsTokenIfNeeded,
  }),
  startupScreen: async () => ({
    printStartupScreen: mockPrintStartupScreen,
  }),
  earlyInput: async () => ({
    startCapturingEarlyInput: mockStartCapturingEarlyInput,
  }),
  main: async () => ({
    main: mockCliMain,
  }),
}

describe('cli.tsx — background routing behavior', () => {
  const bgOptions = {
    bgSessionsEnabled: true,
    importers: mockImporters,
  } as unknown as Parameters<CliMain>[1]
  const originalAutoRunGuard =
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
  const savedArgv = [...process.argv]

  beforeAll(async () => {
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN = '1'

    const entrypoint = await import('./cli.js')
    runCliEntrypoint = entrypoint.main
  })

  afterAll(() => {
    if (originalAutoRunGuard === undefined) {
      delete process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
    } else {
      process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN =
        originalAutoRunGuard
    }
  })

  beforeEach(() => {
    clearRuntimeMocks()
  })

  afterEach(() => {
    process.argv = [...savedArgv]
  })

  it('dispatches background management commands before startup work', async () => {
    const cases: Array<[string, typeof mockPsHandler, string[]]> = [
      ['ps', mockPsHandler, ['--json']],
      ['logs', mockLogsHandler, ['session-1', '-f']],
      ['attach', mockAttachHandler, ['session-1']],
      ['kill', mockKillHandler, ['session-1']],
    ]

    for (const [command, handler, tail] of cases) {
      clearRuntimeMocks()

      await runCliEntrypoint([command, ...tail], bgOptions)

      expect(handler.mock.calls).toEqual([[tail]])
      expect(mockParseProviderEnvFileArgs).not.toHaveBeenCalled()
      expect(mockHandleBgFlag).not.toHaveBeenCalled()
      expect(mockEnableConfigs).not.toHaveBeenCalled()
      expect(mockValidateProviderEnvForStartupOrExit).not.toHaveBeenCalled()
      expect(mockCliMain).not.toHaveBeenCalled()
    }
  })

  it('keeps management commands on the management path even with --bg arguments', async () => {
    const cases: Array<[string, typeof mockPsHandler]> = [
      ['ps', mockPsHandler],
      ['logs', mockLogsHandler],
      ['attach', mockAttachHandler],
      ['kill', mockKillHandler],
    ]

    for (const [command, handler] of cases) {
      clearRuntimeMocks()

      await runCliEntrypoint([command, '--bg', 'session-1'], bgOptions)

      expect(handler.mock.calls).toEqual([[['--bg', 'session-1']]])
      expect(mockParseProviderEnvFileArgs).not.toHaveBeenCalled()
      expect(mockHandleBgFlag).not.toHaveBeenCalled()
      expect(mockEnableConfigs).not.toHaveBeenCalled()
      expect(mockValidateProviderEnvForStartupOrExit).not.toHaveBeenCalled()
      expect(mockCliMain).not.toHaveBeenCalled()
    }
  })

  it('routes real background flags after profile routing without provider validation', async () => {
    const args = ['--background', '--', '--print']

    await runCliEntrypoint(args, bgOptions)

    expect(mockEnableConfigs).toHaveBeenCalledTimes(1)
    expect(mockParseProviderEnvFileArgs.mock.calls).toEqual([[args]])
    expect(mockReapplyRememberedEnvFileValues).toHaveBeenCalledTimes(2)
    expect(mockApplySafeConfigEnvironmentVariables).toHaveBeenCalledTimes(1)
    expect(mockApplyStartupEnvFromProfile).toHaveBeenCalledTimes(1)
    expect(mockEagerLoadSettingsFromArgs.mock.calls).toEqual([[args]])
    expect(mockHandleBgFlag.mock.calls).toEqual([[args]])
    expect(mockRefreshGithubModelsTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockValidateProviderEnvForStartupOrExit).not.toHaveBeenCalled()
    expect(mockCliMain).not.toHaveBeenCalled()
  })

  it('treats --bg after -- as positional text, not a background flag', async () => {
    const args = ['--', '--bg']

    await runCliEntrypoint(args, bgOptions)

    expect(mockHandleBgFlag).not.toHaveBeenCalled()
    expect(mockRefreshGithubModelsTokenIfNeeded).toHaveBeenCalledTimes(1)
    expect(mockHydrateGithubModelsTokenFromSecureStorage).toHaveBeenCalledTimes(
      1,
    )
    expect(mockValidateProviderEnvForStartupOrExit).toHaveBeenCalledTimes(1)
    expect(mockPrintStartupScreen).toHaveBeenCalledTimes(1)
    expect(mockCliMain).toHaveBeenCalledTimes(1)
  })
})

describe('Node 24 premature exit regression (issue #1678)', () => {
  it('built CLI stays alive during initialization in interactive mode without premature exit', async () => {
    const os = await import('node:os')
    const path = await import('node:path')
    const fs = await import('node:fs/promises')
    const url = await import('node:url')

    const scriptPath = path.join(os.tmpdir(), `test-cli-startup-${Date.now()}.mjs`)
    const cliUrl = url.pathToFileURL(path.resolve(import.meta.dir, '../../dist/cli.mjs')).href
    let proc

    try {
      await Bun.write(scriptPath, `
        // Mock TTY so the CLI thinks it's interactive and starts the TUI
        process.stdout.isTTY = true;
        process.stdin.isTTY = true;
        process.stdin.setRawMode = () => {};
        process.env.OPENCLAUDE_DISABLE_TELEMETRY = '1';
        process.env.OPENGATEWAY_API_KEY = 'dummy';

        // Ensure the CLI auto-runs even if the test runner disabled it globally
        delete process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN;

        // Use absolute import to work from os.tmpdir()
        // If the entrypoint uses void main(), this promise resolves immediately.
        // If it correctly uses await main(), it stays pending while the CLI runs.
        import('${cliUrl}').then(() => {
          console.log('---PREMATURE_EVAL_END---');
          process.exit(0);
        });
      `)

      proc = Bun.spawn(['node', scriptPath], { stdout: 'pipe' })
      const reader = proc.stdout.getReader()

      let gotOutput = false
      let evaluationEndedPrematurely = false

      async function readStdout() {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = new TextDecoder().decode(value)
          if (text.includes('---PREMATURE_EVAL_END---')) {
            evaluationEndedPrematurely = true
          } else if (text.trim().length > 0) {
            gotOutput = true
          }
        }
      }

      // Start reading without awaiting it yet
      const readPromise = readStdout()

      // Wait until we get startup output or detect premature evaluation end
      const start = Date.now()
      while (!gotOutput && !evaluationEndedPrematurely && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 10))
      }

      expect(gotOutput).toBe(true)

      // The critical regression window: wait 500ms *after* output.
      // With void main(), Node 24 will exit during the subsequent async imports because the event loop empties,
      // which allows the import() promise above to resolve and emit the signal.
      await new Promise(r => setTimeout(r, 500))

      expect(evaluationEndedPrematurely).toBe(false)
      expect(proc.exitCode).toBe(null)
      expect(proc.killed).toBe(false)
    } finally {
      if (proc && proc.exitCode === null && !proc.killed) {
        proc.kill()
      }
      await fs.unlink(scriptPath).catch(() => {})
    }
  })

  it('cli.tsx uses top-level await for main() to prevent premature exit', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    expect(src).toMatch(/await main\(\)/)
    expect(src).not.toMatch(/^\s*void main\(\)/m)
  })
})

describe('cli.tsx — --yolo alias (PR #1939)', () => {
  const options = {
    importers: mockImporters,
  } as unknown as Parameters<CliMain>[1]
  const originalAutoRunGuard =
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
  const savedArgv = [...process.argv]

  beforeAll(async () => {
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN = '1'
    const entrypoint = await import('./cli.js')
    runCliEntrypoint = entrypoint.main
  })

  afterAll(() => {
    if (originalAutoRunGuard === undefined) {
      delete process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
    } else {
      process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN =
        originalAutoRunGuard
    }
  })

  beforeEach(() => {
    clearRuntimeMocks()
  })

  afterEach(() => {
    process.argv = [...savedArgv]
  })

  // Built from the REAL registration (applyMainOptions), not a local re-declare,
  // so this fails if the alias is dropped/reordered or the canonical attribute
  // name changes. commander derives the attribute from the LAST long flag, so
  // both spellings set dangerouslySkipPermissions — why a native alias works.
  const buildProgram = () =>
    applyMainOptions(new Command()).allowExcessArguments().exitOverride()

  it('the real registration resolves --yolo to dangerouslySkipPermissions', () => {
    expect(
      buildProgram().parse(['node', 'x', '--yolo']).opts()
        .dangerouslySkipPermissions,
    ).toBe(true)
    expect(
      buildProgram().parse(['node', 'x', '--dangerously-skip-permissions']).opts()
        .dangerouslySkipPermissions,
    ).toBe(true)
    expect(
      buildProgram().parse(['node', 'x']).opts().dangerouslySkipPermissions,
    ).toBeUndefined()
  })

  // Regression guard for the six correctness bugs the old pre-parse argv rewrite
  // caused: --yolo must reach commander untouched, whatever position it sits in
  // (after a value flag, after `--`, or on a subcommand), so commander — not a
  // hand-rolled scanner — resolves it.
  it.each([
    [['--yolo', '-p', 'hi']],
    [['--system-prompt', '--yolo']],
    [['-p', '--', '--yolo']],
    [['mcp', 'add', '--yolo', 'srv', 'cmd']],
  ])('passes %j through to cliMain verbatim', async argv => {
    process.argv = ['node', 'openclaude', ...argv]
    let argvSeenByCliMain: string[] | undefined
    mockCliMain.mockImplementationOnce(async () => {
      argvSeenByCliMain = [...process.argv]
    })

    await runCliEntrypoint(argv, options)

    expect(argvSeenByCliMain).toEqual(['node', 'openclaude', ...argv])
  })

  it('does not mutate the host process.argv (no leak of a caller args array)', async () => {
    // main() must not push an explicit args array into the process-global argv:
    // cliMain reads the real process.argv, and leaking a caller's args (e.g. a
    // bypass flag) into it would corrupt an overlapping call or the host.
    const hostArgv = ['node', 'openclaude', 'host-arg']
    process.argv = [...hostArgv]
    await runCliEntrypoint(['--yolo', '-p', 'hi'], options)
    // Assert cliMain actually ran: an early return before it would leave argv
    // untouched for the wrong reason and pass this vacuously. The it.each above
    // is self-protecting (it asserts a value the mock writes); this is not.
    expect(mockCliMain).toHaveBeenCalledTimes(1)
    expect(process.argv).toEqual(hostArgv)
  })

  it('the built CLI lists --yolo on the main command help (live registration)', async () => {
    // Behavioral proof the alias is registered on the real main command — not
    // dead code or the wrong command: commander only prints an option in --help
    // if it is actually registered. --help short-circuits before any startup.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cliPath = path.resolve(import.meta.dir, '../../dist/cli.mjs')
    // Fail loudly (don't silently skip) if the build artifact is missing.
    expect(fs.existsSync(cliPath)).toBe(true)
    // The describe's beforeAll sets OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN=1
    // to keep main() from auto-running in-process; the child must NOT inherit it
    // or the entrypoint never runs and prints nothing.
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      OPENCLAUDE_DISABLE_TELEMETRY: '1',
    }
    delete childEnv.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
    const help = (args: string[]) => {
      const out = Bun.spawnSync(['node', cliPath, ...args], {
        // COLUMNS is pinned because the assertions below match the flags column
        // verbatim: the child inherits the runner's terminal width, and a narrow
        // CI terminal would wrap the 41-character flag string and fail this for
        // reasons unrelated to whether the option is registered.
        env: { ...childEnv, COLUMNS: '200' },
        timeout: 30_000,
      })
      return {
        exitCode: out.exitCode,
        text: `${out.stdout.toString()}${out.stderr.toString()}`,
      }
    }
    // The alias is live on the MAIN command (commander only prints a registered
    // option in --help). Deliberately not asserting `open --help` / `ssh --help`
    // here: DIRECT_CONNECT and SSH_REMOTE are compiled out of the default build,
    // so those render the ROOT help and the assertion would pass even for a
    // nonsense subcommand — i.e. it would prove nothing. Their registrations are
    // covered structurally below and behaviourally in sshPreParse.test.ts.
    const { exitCode, text } = help(['--yolo', '--help'])
    expect(exitCode).toBe(0)
    expect(text).not.toContain('unknown option')
    expect(text).toContain('--yolo, --dangerously-skip-permissions')
    // Guard the reasoning above: if these commands ever ship enabled, revisit.
    // The negative match is only meaningful while commander still renders a
    // Commands: section with two-space subcommand indentation, so that shape is
    // asserted first — otherwise a formatting change would silently retire this
    // canary, and the TEMPORARY source-text guard below depends on it firing.
    const rootHelp = help(['--help']).text
    expect(rootHelp).toContain('Commands:')
    expect(rootHelp).toMatch(/^ {2}agents /m) // a command known to ship enabled
    expect(rootHelp).not.toMatch(/^ {2}(open|ssh)(\s|\|)/m)
  }, 120_000)

  it('routes skills subcommands with --yolo exactly like the canonical flag', () => {
    // The alias is in SKILLS_GLOBAL_BOOLEAN_FLAGS so the skills pre-parsers skip
    // it; dropping it there fails at RUNTIME with `Unknown skills option:
    // --yolo`, which no type check catches. Spawned rather than unit-tested
    // because getSkillsCliArgs is not exported — this exercises the real
    // routing, both pre-parsers included.
    const cli = join(import.meta.dir, '..', '..', 'dist', 'cli.mjs')
    // Isolated home/config: without this the child resolves the runner's real
    // settings and installed skills, so both the `Skills:` header and the parity
    // comparison of two full outputs depend on host state unrelated to --yolo.
    const home = mkdtempSync(join(tmpdir(), 'oc-skills-'))
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      OPENCLAUDE_DISABLE_TELEMETRY: '1',
      COLUMNS: '200',
    }
    delete env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
    // Memoised: the parity loop below asks for the same argv repeatedly, and each
    // spawn is ~1.5s.
    const cache = new Map<string, string>()
    const run = (args: string[]) => {
      const key = args.join(' ')
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      const out = Bun.spawnSync(['node', cli, ...args], { env, timeout: 30_000 })
      const text = `${out.stdout.toString()}${out.stderr.toString()}`
      cache.set(key, text)
      return text
    }
    const output = run

    try {
      // leading and trailing positions both route to the skills handler
      expect(output(['--yolo', 'skills', 'list'])).toContain('Skills:')
      expect(output(['skills', 'list', '--yolo'])).toContain('Skills:')
      expect(output(['--yolo', 'skills', 'list'])).not.toContain('Unknown skills')
      expect(output(['skills', 'list', '--yolo'])).not.toContain('Unknown skills')

      // The alias must behave EXACTLY like the flag it aliases, in every position
      // — including the one neither supports. A global boolean between `skills`
      // and its subcommand is rejected for the whole set (--verbose, --bare, --ide
      // …), so this pins parity rather than a fix for that pre-existing gap.
      for (const position of [
        (f: string) => [f, 'skills', 'list'],
        (f: string) => ['skills', 'list', f],
        (f: string) => ['skills', f, 'list'],
      ]) {
        expect(output(position('--yolo'))).toBe(
          // replaceAll, not replace: an output naming the canonical flag twice
          // (an error line plus a usage line, say) would otherwise keep the
          // second occurrence and fail for a reason unrelated to alias parity.
          output(position('--dangerously-skip-permissions')).replaceAll(
            '--dangerously-skip-permissions',
            '--yolo',
          ),
        )
      }
    } finally {
      // Always: an assertion throwing above would otherwise leave the
      // mkdtemp directory behind for the life of the machine.
      rmSync(home, { recursive: true, force: true })
    }
  }, 120_000)

  it('has no raw --print token scans left in main.tsx (PR #1939 review P1)', async () => {
    // `openclaude ssh host -- --print` is deliberately NOT headless, and the
    // ssh flow rewrites argv to a literal `-- --print` positional. Any gate
    // that decides print mode by scanning tokens sees that positional and takes
    // the local print path instead of opening the interactive remote session.
    // Every such gate must ask commander (resolvesPrintMode), which honours the
    // end-of-options boundary — and bundled shorts like `-pv`.
    //
    // This is a source guard because SSH_REMOTE and DIRECT_CONNECT are absent
    // from scripts/build.ts's featureFlags map, so they compile to `false` with
    // no opt-in: the rewritten-argv path cannot be reached through dist/cli.mjs
    // at all. Behavioural coverage lives at the parseSshFlags boundary in
    // utils/sshPreParse.test.ts.
    // Covers every startup path that decides print mode, not just main.tsx:
    // interactivity/earlyInput/providerValidation/gracefulShutdown all see the
    // rewritten argv too, and a scan in any of them reintroduces the misroute.
    const files = [
      '../main.tsx',
      '../utils/interactivity.ts',
      '../utils/earlyInput.ts',
      '../utils/providerValidation.ts',
      '../utils/gracefulShutdown.ts',
    ]
    // Scanned per file, never concatenated: a joined blob made the reported
    // line number an offset into it, so a failure pointed at a line that exists
    // in no file, and a set-wide `toContain` passed as long as any one file kept
    // its gate.
    const sources = new Map<string, string>()
    for (const rel of files) {
      sources.set(rel, await Bun.file(`${import.meta.dir}/${rel}`).text())
    }
    const rawScans = [...sources.entries()]
      .flatMap(([rel, text]) =>
        text
          .split(/\r?\n/)
          .map((line, i) => [`${rel}:${i + 1}`, line] as const),
      )
      .filter(([, line]) =>
        // Any shape of token comparison, not just the two that existed:
        // .includes(), .indexOf() !== -1, .some()/.find() with ===, a bare
        // === / !== against the literal, or a `case '-p':`.
        [
          /\.(includes|indexOf|lastIndexOf)\(\s*'(-p|--print|--init-only|--sdk-url)'\s*\)/,
          /\.(some|find|findIndex|filter)\([^)]*(===|!==|startsWith)\s*\(?\s*'(-p|--print|--init-only|--sdk-url)'/,
          /(===|!==)\s*'(-p|--print|--init-only|--sdk-url)'/,
          /case\s+'(-p|--print|--init-only|--sdk-url)'\s*:/,
        ].some(re => re.test(line)),
      )
    expect(rawScans.map(([where, line]) => `${where}  ${line.trim()}`)).toEqual([])
    // …and EVERY file still consults commander. Asserted per file: against the
    // concatenated text these passed as long as any one file kept its gate, so
    // deleting the gate in (say) earlyInput.ts tripped neither this nor the
    // raw-scan filter above — the very misroute this test exists to prevent.
    // Collected rather than asserted per iteration, so a failure names the files
    // that lost their gate instead of only reporting the missing substring.
    // Either entry point counts — both resolve through commander. Callers that
    // need more than print mode use resolvesHeadlessFlags (which also covers
    // --init-only and --sdk-url); resolvesPrintMode is the thin wrapper.
    const withoutGate = [...sources.entries()]
      .filter(([, text]) => !/resolves(PrintMode|HeadlessFlags)\(/.test(text))
      .map(([rel]) => rel)
    expect(withoutGate).toEqual([])

    // Same reasoning for the remote-session bypass guards: DIRECT_CONNECT and
    // SSH_REMOTE compile out, so the wiring cannot be exercised at runtime. The
    // helpers themselves are unit-tested in mainCliOptions.test.ts; these pin
    // that main.tsx actually calls all three (flag, --permission-mode, and the
    // resolved-mode backstop that covers settings `permissions.defaultMode`).
    const mainOnly = sources.get('../main.tsx')!
    expect(mainOnly).toContain('localDangerouslySkipPermissions(')
    expect(mainOnly).toContain('localPermissionModeCli(')
    expect(mainOnly).toContain('localResolvedPermissionMode(')

    // The ssh headless rejection must sit OUTSIDE the host check: print shorts
    // are not ssh-side options, so `ssh -p host` leaves the host unbound and an
    // inside-the-check guard is skipped entirely, falling through to the local
    // print path with the trust dialog skipped.
    // Both indices asserted: -1 from either would slice from the end of the
    // file and leave the ordering assertion comparing literals found anywhere
    // later — reporting a pass while the guard sits back inside the host check.
    const sshStart = mainOnly.indexOf('const parsed = parseSshFlags(rawCliArgs)')
    const sshEnd = mainOnly.indexOf('_pendingSSH.host = parsed.host')
    expect(sshStart).toBeGreaterThan(-1)
    expect(sshEnd).toBeGreaterThan(sshStart)
    const sshBlock = mainOnly.slice(sshStart, sshEnd)
    expect(sshBlock).toContain('if (parsed.headless)')
    expect(sshBlock.indexOf('if (parsed.headless)')).toBeLessThan(
      sshBlock.indexOf('if (parsed.host !== undefined)'),
    )

    // The remote-bypass warning must be fed per PATH, from every source that
    // reaches THAT remote. `cc://` forwards the request itself (all three
    // doors, settings included); ssh forwards only what its own argv resolved,
    // which is invisible locally — `ssh --yolo host` claims the flag for the
    // remote and forwards nothing, so the local option is unset.
    const ccStart = mainOnly.indexOf('const ccRemoteBypass =')
    const ccEnd = mainOnly.indexOf('const sshRemoteBypass =')
    expect(ccStart).toBeGreaterThan(-1)
    expect(ccEnd).toBeGreaterThan(ccStart)
    expect(mainOnly.slice(ccStart, ccEnd)).toContain('remoteBypassRequested')

    // and remoteBypassRequested itself covers all three doors
    const reqStart = mainOnly.indexOf('const remoteBypassRequested =')
    const reqEnd = mainOnly.indexOf(';', reqStart)
    expect(reqStart).toBeGreaterThan(-1)
    expect(reqEnd).toBeGreaterThan(reqStart)
    const request = mainOnly.slice(reqStart, reqEnd)
    expect(request).toContain('dangerouslySkipPermissions')
    expect(request).toContain('permissionModeCli')
    expect(request).toContain('permissionModeFromCLI')

    // ssh must NOT inherit the cc:// term: a settings-derived dangerous mode is
    // forwarded by createDirectConnectSession but never by the ssh launch
    // contract, so counting it for ssh claims a bypass the remote never got.
    // Anchored on the CALL, not the bare name: `setRemoteBypassPermissions`
    // also appears in the import list at the top of the file, so indexOf found
    // that first and produced an empty slice that asserted nothing.
    const sshTermStart = mainOnly.indexOf('const sshRemoteBypass =')
    const sshTermEnd = mainOnly.indexOf(
      'setRemoteBypassPermissions(ccRemoteBypass',
    )
    expect(sshTermStart).toBeGreaterThan(-1)
    expect(sshTermEnd).toBeGreaterThan(sshTermStart)
    const sshTerm = mainOnly.slice(sshTermStart, sshTermEnd)
    expect(sshTerm).not.toContain('remoteBypassRequested')
    expect(sshTerm).toContain('_pendingSSH?.dangerouslySkipPermissions')
    expect(sshTerm).toContain('_pendingSSH?.permissionMode')
  })

  it('lists both spellings in the published web flag reference', async () => {
    // web/ has no test runner (only `astro check` / `astro build`), so this is
    // asserted from here rather than introducing a framework to that package.
    // Read as text, not imported: web/ is outside this tsconfig's rootDir, and
    // importing it fails typecheck with TS6059.
    const webFlags = await Bun.file(
      `${import.meta.dir}/../../web/src/data/cliFlags.ts`,
    ).text()

    // the documented entry names both spellings, in the order commander uses
    // (alias first, canonical last — see BYPASS_PERMISSIONS_FLAGS)
    expect(webFlags).toContain(
      "flag: '--yolo, --dangerously-skip-permissions'",
    )
    // …and the separate --allow- flag is still documented on its own
    expect(webFlags).toContain("flag: '--allow-dangerously-skip-permissions'")
    // no stray entry documents the bare canonical flag on its own
    expect(webFlags).not.toContain("flag: '--dangerously-skip-permissions'")
  })

  it('registers --yolo via .option() on the main command, ssh, and open subcommands', async () => {
    // Supplementary structural guard (the executable --help test above is the
    // primary proof): each occurrence must be a real .option() registration.
    //
    // TEMPORARY: source-text matching is a stand-in for coverage that cannot
    // exist yet. SSH_REMOTE and DIRECT_CONNECT are absent from the featureFlags
    // map in scripts/build.ts, so feature() compiles them to false and neither
    // subcommand is reachable in dist/cli.mjs. The moment either flag ships
    // enabled, replace this with behavioural `ssh --help` / `open --help`
    // assertions — the `expect(help(['--help']).text).not.toMatch(/^ {2}(open|ssh) /m)`
    // guard in the test above fails when that happens, so it cannot go unnoticed.
    // The main-command option lives in mainCliOptions.ts (applyMainOptions,
    // reused by the ssh pre-parser); ssh + open subcommands are in main.tsx.
    const mainSrc = await Bun.file(`${import.meta.dir}/../main.tsx`).text()
    const optsSrc = await Bun.file(`${import.meta.dir}/../mainCliOptions.ts`).text()
    // All four sites now register via the shared BYPASS_PERMISSIONS_FLAGS
    // constant, so match either that identifier or an inline literal — the
    // exact string it holds is pinned in mainCliOptions.test.ts.
    const registration =
      /\.option\(\s*(BYPASS_PERMISSIONS_FLAGS|'--yolo, --dangerously-skip-permissions')/
    // Per-command assertions rather than a total count, so adding a fourth
    // registration elsewhere doesn't break this guard.
    expect(optsSrc).toMatch(registration) // main command (applyMainOptions)
    // …and the constant really is the flags string (not, say, re-pointed at a
    // different option), so matching the identifier above still proves the
    // right flag is registered.
    expect(optsSrc).toMatch(
      /export const BYPASS_PERMISSIONS_FLAGS\s*=\s*'--yolo, --dangerously-skip-permissions' as const/,
    )
    // For the subcommands, check the registration sits inside that command's
    // own `.command('…')` statement. NB: `ssh --help` renders the ROOT help
    // (the ssh registration exists only so the command is listed), so a --help
    // assertion would silently re-test the main command — hence source checks.
    const commandStatement = (name: string) => {
      const start = mainSrc.indexOf(`program.command('${name}`)
      expect(start).toBeGreaterThan(-1)
      // Without this, a missing `.action(` yields -1 and slice(start, -1)
      // spans the rest of the file — the regex would then match a DIFFERENT
      // command's registration and the guard would pass vacuously.
      const end = mainSrc.indexOf('.action(', start)
      expect(end).toBeGreaterThan(start)
      return mainSrc.slice(start, end)
    }
    expect(commandStatement('ssh <host> [dir]')).toMatch(registration)
    expect(commandStatement('open <cc-url>')).toMatch(registration)
    // `ssh --yolo` is parsed by the ssh pre-parser (parseSshFlags), which reuses
    // the main option arities; its handling has runtime tests in
    // utils/sshPreParse.test.ts.
    expect(mainSrc).toContain('parseSshFlags(rawCliArgs)')
  })
})
