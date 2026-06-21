import { expect, mock, test } from 'bun:test'

/**
 * Each test in this file sets up mock.module mocks before dynamically importing
 * `./worktree.js` with a unique cache-busting query param. This keeps mocks
 * isolated per test even though mock.module is process-global in Bun.
 */
let importCounter = 0

async function importTestModule(mocks: Record<string, () => object>) {
  importCounter++
  const suffix = `${Date.now()}.${importCounter}.${Math.random().toString(36).slice(2, 8)}`
  for (const [modPath, factory] of Object.entries(mocks)) {
    mock.module(modPath, factory)
  }
  return await import(`./worktree.js?cachebust=${suffix}`)
}

// Bun's mock.module validates that the mock factory provides ALL exports that
// the real module exposes (including re-exports). These helpers enumerate the
// full export set so we don't hit SyntaxError at import time.

function makeSettingsMock(custom: object) {
  return {
    getInitialSettings: () => ({}),
    getRelativeSettingsFilePathForSource: () => undefined,
    getSettingsForSource: () => null,
    loadManagedFileSettings: () => ({}),
    getManagedFileSettingsPresence: () => ({}),
    parseSettingsFile: () => ({}),
    getSettingsRootPathForSource: () => '',
    getSettingsFilePathForSource: () => '',
    updateSettingsForSource: async () => {},
    settingsMergeCustomizer: () => ({}),
    getManagedSettingsKeysForLogging: () => [],
    getSettings_DEPRECATED: () => ({}),
    getSettingsWithSources: () => ({}),
    getSettingsWithErrors: () => ({}),
    hasSkipDangerousModePermissionPrompt: () => false,
    hasSkipFullAccessModePermissionPrompt: () => false,
    hasAllowBypassPermissionsMode: () => false,
    hasAutoModeOptIn: () => false,
    getUseAutoModeDuringPlan: () => false,
    getAutoModeConfig: () => ({}),
    rawSettingsContainsKey: () => false,
    getPolicySettingsOrigin: () => null,
    ...custom,
  }
}

function makeExecNoThrowMock(custom: object) {
  return {
    execFileNoThrow: async () => ({ code: 0, stdout: '', stderr: '' }),
    execFileNoThrowWithCwd: async () => ({ code: 0, stdout: '', stderr: '' }),
    execSyncWithDefaults_DEPRECATED: () => ({ status: 0, stdout: '', stderr: '' }),
    ...custom,
  }
}

// ---------------------------------------------------------------------------
// enableGitLongPathsForWorktrees — setting gating
// ---------------------------------------------------------------------------

test('enableGitLongPaths applies core.longpaths on Windows when setting is unset (default on)', async () => {
  const execMock = mock(
    async (_exe: string, _args: string[], _opts?: object) => ({
      code: 0,
      stdout: '',
      stderr: '',
    }),
  )

  const { _test } = await importTestModule({
    './platform.js': () => ({
      SUPPORTED_PLATFORMS: ['windows'],
      getPlatform: () => 'windows',
      getWslVersion: () => undefined,
      getLinuxDistroInfo: () => undefined,
      detectVcs: async () => [],
    }),
    './settings/settings.js': () => makeSettingsMock({}),
    './execFileNoThrow.js': () => makeExecNoThrowMock({ execFileNoThrowWithCwd: execMock }),
  })

  await _test.enableGitLongPathsForWorktrees('/repo')

  expect(execMock).toHaveBeenCalledTimes(1)
  expect(execMock).toHaveBeenCalledWith(
    expect.any(String),
    ['config', '--local', 'core.longpaths', 'true'],
    expect.objectContaining({ cwd: '/repo' }),
  )
})

test('enableGitLongPaths skips core.longpaths on Windows when setting is false', async () => {
  const execMock = mock(
    async (_exe: string, _args: string[], _opts?: object) => ({
      code: 0,
      stdout: '',
      stderr: '',
    }),
  )

  const { _test } = await importTestModule({
    './platform.js': () => ({
      SUPPORTED_PLATFORMS: ['windows'],
      getPlatform: () => 'windows',
      getWslVersion: () => undefined,
      getLinuxDistroInfo: () => undefined,
      detectVcs: async () => [],
    }),
    './settings/settings.js': () =>
      makeSettingsMock({
        getInitialSettings: () => ({
          worktree: { enableGitLongPaths: false },
        }),
      }),
    './execFileNoThrow.js': () => makeExecNoThrowMock({ execFileNoThrowWithCwd: execMock }),
  })

  await _test.enableGitLongPathsForWorktrees('/repo')
  expect(execMock).not.toHaveBeenCalled()
})

test('enableGitLongPaths skips core.longpaths on non-Windows', async () => {
  const execMock = mock(
    async (_exe: string, _args: string[], _opts?: object) => ({
      code: 0,
      stdout: '',
      stderr: '',
    }),
  )

  const { _test } = await importTestModule({
    './platform.js': () => ({
      SUPPORTED_PLATFORMS: ['linux'],
      getPlatform: () => 'linux',
      getWslVersion: () => undefined,
      getLinuxDistroInfo: () => undefined,
      detectVcs: async () => [],
    }),
    './settings/settings.js': () => makeSettingsMock({}),
    './execFileNoThrow.js': () => makeExecNoThrowMock({ execFileNoThrowWithCwd: execMock }),
  })

  await _test.enableGitLongPathsForWorktrees('/repo')
  expect(execMock).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// getOrCreateWorktree — git invocation ordering and error recovery
// ---------------------------------------------------------------------------

const GIT_SHA = 'abc123def456abc123def456abc123def4567890\n'

function makeBaseMocks(execMock: ReturnType<typeof mock>) {
  return {
    './platform.js': () => ({
      SUPPORTED_PLATFORMS: ['windows'],
      getPlatform: () => 'windows',
      getWslVersion: () => undefined,
      getLinuxDistroInfo: () => undefined,
      detectVcs: async () => [],
    }),
    './settings/settings.js': () => makeSettingsMock({}),
    './git/gitFilesystem.js': () => ({
      clearResolveGitDirCache: () => {},
      resolveGitDir: () => '/repo/.git',
      isSafeRefName: () => true,
      isValidGitSha: () => true,
      readGitHead: async () => null,
      resolveRef: () => null,
      getCommonDir: () => '/repo',
      readRawSymref: async () => null,
      getCachedBranch: async () => 'main',
      getCachedHead: async () => '',
      getCachedRemoteUrl: async () => null,
      getCachedDefaultBranch: async () => 'main',
      resetGitFileWatcher: () => {},
      getHeadForDir: async () => null,
      readWorktreeHeadSha: () => null,
      getRemoteUrlForDir: async () => null,
      isShallowClone: async () => false,
      getWorktreeCountFromFs: async () => 0,
    }),
    './git.js': () => ({
      findGitRoot: () => '/repo',
      findCanonicalGitRoot: () => '/repo',
      gitExe: () => 'git',
      getIsGit: async () => true,
      getGitDir: async () => '/repo/.git',
      isAtGitRoot: async () => true,
      dirIsInGitRepo: async () => true,
      getHead: async () => 'abc123',
      getBranch: () => 'main',
      getDefaultBranch: () => 'main',
      getRemoteUrl: async () => null,
      normalizeGitRemoteUrl: () => null,
      getRepoRemoteHash: async () => null,
      getIsHeadOnRemote: async () => true,
      hasUnpushedCommits: async () => false,
      getIsClean: async () => true,
      getChangedFiles: async () => [],
      getFileStatus: async () => ({}),
      getWorktreeCount: async () => 0,
      stashToCleanState: async () => true,
      getGitState: async () => null,
      getGithubRepo: async () => null,
      findRemoteBase: async () => null,
      preserveGitStateForIssue: async () => null,
      isCurrentDirectoryBareGitRepo: () => false,
    }),
    './debug.js': () => ({
      getMinDebugLogLevel: () => 0,
      isDebugMode: () => false,
      enableDebugLogging: () => {},
      getDebugFilter: () => '',
      isDebugToStdErr: () => false,
      getDebugFilePath: () => '',
      setHasFormattedOutput: () => {},
      getHasFormattedOutput: () => false,
      flushDebugLogs: async () => {},
      logForDebugging: () => {},
      getDebugLogPath: () => '',
      logAntError: () => {},
    }),
    './config.js': () => ({
      SHOW_CACHE_STATS_MODES: [],
      MAX_MESSAGES_COMPACTION_THRESHOLDS: [],
      normalizeMaxMessagesCompactionThreshold: () => 0,
      DEFAULT_GLOBAL_CONFIG: {},
      GLOBAL_CONFIG_KEYS: [],
      isGlobalConfigKey: () => false,
      PROJECT_CONFIG_KEYS: [],
      resetTrustDialogAcceptedCacheForTesting: () => {},
      checkHasTrustDialogAccepted: () => false,
      isPathTrusted: () => true,
      isProjectConfigKey: () => false,
      saveGlobalConfig: async () => {},
      getGlobalConfigWriteCount: () => 0,
      CONFIG_WRITE_DISPLAY_THRESHOLD: 0,
      getGlobalConfig: () => ({}),
      getRemoteControlAtStartup: () => null,
      getCustomApiKeyStatus: () => null,
      enableConfigs: () => true,
      getProjectPathForConfig: () => '',
      getCurrentProjectConfig: () => ({}),
      saveCurrentProjectConfig: async () => {},
      isAutoUpdaterDisabled: () => false,
      shouldSkipPluginAutoupdate: () => false,
      formatAutoUpdaterDisabledReason: () => '',
      getAutoUpdaterDisabledReason: () => '',
      getOrCreateUserID: async () => '',
      recordFirstStartTime: async () => {},
      getMemoryPath: () => '',
      getManagedClaudeRulesDir: () => '',
      getUserClaudeRulesDir: () => '',
      _getConfigForTesting: () => ({}),
      _wouldLoseAuthStateForTesting: () => false,
      _setGlobalConfigCacheForTesting: () => {},
    }),
    './errors.js': () => ({
      isAbortError: () => false,
      hasExactErrorMessage: () => false,
      toError: (e: unknown) => e instanceof Error ? e : new Error(String(e)),
      errorMessage: (e: unknown) => String(e),
      getErrnoCode: () => 'TEST',
      isENOENT: () => false,
      getErrnoPath: () => '',
      shortErrorStack: () => '',
      isFsInaccessible: () => false,
      sdkErrorFromType: () => ({} as Error),
      classifyAxiosError: () => null,
    }),
    './cwd.js': () => ({
      runWithCwdOverride: async () => {},
      pwd: () => '/repo',
      getCwd: () => '/repo',
    }),
    './path.js': () => ({
      expandPath: (p: string) => p,
      toRelativePath: (p: string) => p,
      getDirectoryForPath: (p: string) => p,
      containsPathTraversal: () => false,
      normalizePathForConfigKey: (p: string) => p,
    }),
    './sleep.js': () => ({
      sleep: async () => {},
      withTimeout: async <T>(p: Promise<T>) => p,
    }),
    './hooks.js': () => ({
      isFallbackAgentLaunchSuccessStatus: () => false,
      getSessionEndHookTimeoutMs: () => 5000,
      shouldSkipHookDueToTrust: () => false,
      createBaseHookInput: () => ({}),
      getMatchingHooks: async () => [],
      getPreToolHookBlockingMessage: () => null,
      getStopHookMessage: () => '',
      getTeammateIdleHookMessage: () => null,
      getTaskCreatedHookMessage: () => null,
      getTaskCompletedHookMessage: () => null,
      getUserPromptSubmitHookBlockingMessage: () => null,
      hasBlockingResult: () => false,
      executeNotificationHooks: async () => {},
      executeStopFailureHooks: async () => {},
      executePreCompactHooks: async () => {},
      executePostCompactHooks: async () => {},
      executeSessionEndHooks: async () => {},
      executeConfigChangeHooks: async () => {},
      executeCwdChangedHooks: async () => {},
      executeFileChangedHooks: async () => {},
      hasInstructionsLoadedHook: () => false,
      executeInstructionsLoadedHooks: async () => {},
      executeElicitationHooks: async () => {},
      executeElicitationResultHooks: async () => {},
      executeStatusLineCommand: async () => '',
      executeFileSuggestionCommand: async () => '',
      hasWorktreeCreateHook: () => false,
      executeWorktreeCreateHook: async () => {},
      executeWorktreeRemoveHook: async () => {},
    }),
    './swarm/backends/detection.js': () => ({
      isInsideTmuxSync: () => false,
      isInsideTmux: () => false,
      getLeaderPaneId: () => null,
      isTmuxAvailable: () => false,
      isInITerm2: () => false,
      IT2_COMMAND: '',
      isIt2CliAvailable: () => false,
      resetDetectionCache: () => {},
    }),
    './execFileNoThrow.js': () =>
      makeExecNoThrowMock({ execFileNoThrowWithCwd: execMock }),
    'fs/promises': () => ({
      mkdir: async () => {},
      copyFile: async () => {},
      readdir: async () => [],
      readFile: async () => '',
      stat: async () => ({}),
      symlink: async () => {},
      utimes: async () => {},
    }),
    ignore: () => ({
      default: () => ({ add: () => {}, ignores: () => false }),
    }),
    child_process: () => ({
      spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
    }),
    chalk: () => ({
      default: { red: (s: string) => s },
    }),
  }
}

test('getOrCreateWorktree calls core.longpaths before worktree add on Windows', async () => {
  const gitCalls: string[] = []
  const execMock = mock(
    async (_exe: string, args: string[], _opts?: object) => {
      const joined = args.join(' ')
      gitCalls.push(joined)
      if (joined.includes('rev-parse')) {
        return { code: 0, stdout: GIT_SHA, stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  )

  const mocks = makeBaseMocks(execMock)
  const { _test } = await importTestModule(mocks)

  await _test.getOrCreateWorktree('/repo', 'my-slug')

  const longpathsIdx = gitCalls.findIndex((c: string) =>
    c.includes('config --local core.longpaths'),
  )
  const addIdx = gitCalls.findIndex((c: string) =>
    c.includes('worktree add'),
  )

  expect(longpathsIdx).toBeGreaterThanOrEqual(0)
  expect(addIdx).toBeGreaterThanOrEqual(0)
  expect(longpathsIdx).toBeLessThan(addIdx)
})

test('getOrCreateWorktree cleans up with worktree remove --force on failure', async () => {
  const execMock = mock(
    async (_exe: string, args: string[], _opts?: object) => {
      const joined = args.join(' ')
      if (joined.includes('rev-parse')) {
        return { code: 0, stdout: GIT_SHA, stderr: '' }
      }
      if (joined.includes('worktree add')) {
        return { code: 1, stdout: '', stderr: 'checkout failed' }
      }
      if (joined.includes('worktree remove')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  )

  const mocks = makeBaseMocks(execMock)
  const { _test } = await importTestModule(mocks)

  await expect(_test.getOrCreateWorktree('/repo', 'my-slug')).rejects.toThrow(
    'Failed to create worktree',
  )

  const removeCall = execMock.mock.calls.find(
    (c: [_exe: string, args: string[], _opts?: object]) =>
      c[1].join(' ').includes('worktree remove'),
  )
  expect(removeCall).toBeDefined()
  expect(removeCall![1]).toContain('--force')
})

test('getOrCreateWorktree does not call core.longpaths on non-Windows', async () => {
  const gitCalls: string[] = []
  const execMock = mock(
    async (_exe: string, args: string[], _opts?: object) => {
      const joined = args.join(' ')
      gitCalls.push(joined)
      if (joined.includes('rev-parse')) {
        return { code: 0, stdout: GIT_SHA, stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  )

  const mocks = makeBaseMocks(execMock)
  mocks['./platform.js'] = () => ({
    SUPPORTED_PLATFORMS: ['linux'],
    getPlatform: () => 'linux',
    getWslVersion: () => undefined,
    getLinuxDistroInfo: () => undefined,
    detectVcs: async () => [],
  })

  const { _test } = await importTestModule(mocks)

  await _test.getOrCreateWorktree('/repo', 'my-slug')

  const longpathsCalls = gitCalls.filter((c: string) =>
    c.includes('config --local core.longpaths'),
  )
  expect(longpathsCalls).toHaveLength(0)
})
