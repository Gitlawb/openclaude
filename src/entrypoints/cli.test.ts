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

describe('cli.tsx — background routing behavior', () => {
  const bgOptions = {
    bgSessionsEnabled: true,
    importers: {
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
    },
  } as unknown as Parameters<CliMain>[1]
  const originalAutoRunGuard =
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN

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
