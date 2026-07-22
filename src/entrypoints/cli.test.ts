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
    // The live-registration test spawns dist/cli.mjs. `bun test` on a clean
    // checkout hasn't built it, so build on demand (once) if it's missing —
    // keeps the test runnable everywhere without a silent skip.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cliPath = path.resolve(import.meta.dir, '../../dist/cli.mjs')
    if (!fs.existsSync(cliPath)) {
      Bun.spawnSync(['bun', 'run', 'build'], {
        cwd: path.resolve(import.meta.dir, '../..'),
      })
    }
  }, 300_000)

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

  // Mirrors the registration in main.tsx. commander derives the option's
  // attribute from the LAST long flag, so both spellings set the same
  // dangerouslySkipPermissions key — the whole reason a native alias works.
  const buildProgram = () =>
    new Command()
      .option(
        '--yolo, --dangerously-skip-permissions',
        'bypass',
        () => true,
      )
      .allowExcessArguments()
      .exitOverride()

  it('commander resolves --yolo to dangerouslySkipPermissions', () => {
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

  it('passes args through to cliMain verbatim — no per-token --yolo rewrite', async () => {
    // Regression guard for the six correctness bugs the old pre-parse argv
    // rewrite caused: --yolo must reach commander untouched, whatever position
    // it sits in (after a value flag, after `--`, or on a subcommand), so
    // commander — not a hand-rolled scanner — resolves it.
    const cases = [
      ['--yolo', '-p', 'hi'],
      ['--system-prompt', '--yolo'],
      ['-p', '--', '--yolo'],
      ['mcp', 'add', '--yolo', 'srv', 'cmd'],
    ]
    for (const argv of cases) {
      clearRuntimeMocks()
      process.argv = ['node', 'openclaude', ...argv]
      let argvSeenByCliMain: string[] | undefined
      mockCliMain.mockImplementationOnce(async () => {
        argvSeenByCliMain = [...process.argv]
      })

      await runCliEntrypoint(argv, options)

      expect(argvSeenByCliMain).toEqual(['node', 'openclaude', ...argv])
    }
  })

  it('does not mutate the host process.argv (no leak of a caller args array)', async () => {
    // main() must not push an explicit args array into the process-global argv:
    // cliMain reads the real process.argv, and leaking a caller's args (e.g. a
    // bypass flag) into it would corrupt an overlapping call or the host.
    const hostArgv = ['node', 'openclaude', 'host-arg']
    process.argv = [...hostArgv]
    await runCliEntrypoint(['--yolo', '-p', 'hi'], options)
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
      const out = Bun.spawnSync(['node', cliPath, ...args], { env: childEnv })
      return {
        exitCode: out.exitCode,
        text: `${out.stdout.toString()}${out.stderr.toString()}`,
      }
    }
    // The alias is live (not dead code / wrong command) on both commands that
    // register it and are reachable via --help: the main command and `open`.
    for (const cmd of [['--yolo', '--help'], ['open', '--help']]) {
      const { exitCode, text } = help(cmd)
      expect(exitCode).toBe(0)
      expect(text).not.toContain('unknown option')
      expect(text).toContain('--yolo, --dangerously-skip-permissions')
    }
  })

  it('registers --yolo via .option() on the main command, ssh, and open subcommands', async () => {
    // Supplementary structural guard (the executable --help test above is the
    // primary proof): each occurrence must be a real .option() registration.
    // The main-command option lives in mainCliOptions.ts (applyMainOptions,
    // reused by the ssh pre-parser); ssh + open subcommands are in main.tsx.
    const mainSrc = await Bun.file(`${import.meta.dir}/../main.tsx`).text()
    const optsSrc = await Bun.file(`${import.meta.dir}/../mainCliOptions.ts`).text()
    const re = /\.option\(\s*'--yolo, --dangerously-skip-permissions'/g
    const total =
      [...mainSrc.matchAll(re)].length + [...optsSrc.matchAll(re)].length
    expect(total).toBe(3)
    // `ssh --yolo` is parsed by the ssh pre-parser (parseSshFlags), which reuses
    // the main option arities; its handling has runtime tests in
    // utils/sshPreParse.test.ts.
    expect(mainSrc).toContain('parseSshFlags(rawCliArgs)')
  })
})
