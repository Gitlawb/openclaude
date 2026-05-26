import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

type TestGlobalConfig = {
  officialMarketplaceAutoInstallAttempted?: boolean
  officialMarketplaceAutoInstalled?: boolean
  officialMarketplaceAutoInstallFailReason?:
    | 'policy_blocked'
    | 'git_unavailable'
    | 'gcs_unavailable'
    | 'unknown'
  officialMarketplaceAutoInstallRetryCount?: number
  officialMarketplaceAutoInstallLastAttemptTime?: number
  officialMarketplaceAutoInstallNextRetryTime?: number
}

let config: TestGlobalConfig = {}
let knownMarketplaces: Record<string, unknown> = {}
const saveGlobalConfig = mock(
  (updater: (current: TestGlobalConfig) => TestGlobalConfig) => {
    config = updater(config)
  },
)
const saveKnownMarketplacesConfig = mock(
  async (next: Record<string, unknown>) => {
    knownMarketplaces = next
  },
)
const fetchOfficialMarketplaceFromGcs = mock(async () => 'sha')
const addMarketplaceSource = mock(async () => ({
  name: 'claude-plugins-official',
  alreadyMaterialized: false,
  resolvedSource: {},
}))

await acquireSharedMutationLock('utils/plugins/officialMarketplaceStartupCheck.test.ts')

mock.module('../../services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => true,
}))

mock.module('../../services/analytics/index.js', () => ({
  logEvent: mock(() => {}),
}))

mock.module('../config.js', () => ({
  checkHasTrustDialogAccepted: () => true,
  enableConfigs: mock(() => {}),
  getCurrentProjectConfig: () => ({}),
  getGlobalConfig: () => config,
  getGlobalConfigWriteCount: () => 0,
  getAutoUpdaterDisabledReason: () => null,
  formatAutoUpdaterDisabledReason: () => 'enabled',
  getManagedClaudeRulesDir: () => '/tmp/openclaude-managed-rules',
  getMemoryPath: () => '/tmp/openclaude-memory.md',
  getOrCreateUserID: () => 'test-user-id',
  getProjectPathForConfig: () => '/tmp/openclaude-project-config.json',
  getRemoteControlAtStartup: () => false,
  getUserClaudeRulesDir: () => '/tmp/openclaude-user-rules',
  isAutoUpdaterDisabled: () => false,
  recordFirstStartTime: mock(() => {}),
  getCustomApiKeyStatus: () => ({ hasCustomApiKey: false }),
  isGlobalConfigKey: () => false,
  isPathTrusted: () => true,
  isProjectConfigKey: () => false,
  resetTrustDialogAcceptedCacheForTesting: mock(() => {}),
  shouldSkipPluginAutoupdate: () => false,
  saveGlobalConfig,
  saveCurrentProjectConfig: mock(() => {}),
}))

mock.module('../debug.js', () => ({
  logForDebugging: mock(() => {}),
}))

mock.module('../log.js', () => ({
  logError: mock(() => {}),
}))

mock.module('./gitAvailability.js', () => ({
  checkGitAvailable: async () => true,
  markGitUnavailable: mock(() => {}),
}))

mock.module('./marketplaceHelpers.js', () => ({
  isSourceAllowedByPolicy: () => true,
}))

mock.module('./marketplaceManager.js', () => ({
  addMarketplaceSource,
  getMarketplace: async () => ({ plugins: [] }),
  getMarketplaceCacheOnly: async () => ({ plugins: [] }),
  getMarketplacesCacheDir: () => '/tmp/openclaude-marketplaces',
  getPluginById: async () => undefined,
  getPluginByIdCacheOnly: async () => undefined,
  loadKnownMarketplacesConfig: async () => knownMarketplaces,
  loadKnownMarketplacesConfigSafe: async () => knownMarketplaces,
  saveKnownMarketplacesConfig,
}))

mock.module('./officialMarketplaceGcs.js', () => ({
  fetchOfficialMarketplaceFromGcs,
}))

let checkAndInstallOfficialMarketplace:
  typeof import('./officialMarketplaceStartupCheck.js').checkAndInstallOfficialMarketplace

const mod = await import('./officialMarketplaceStartupCheck.js')
checkAndInstallOfficialMarketplace = mod.checkAndInstallOfficialMarketplace

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

beforeEach(() => {
  config = {}
  knownMarketplaces = {}
  saveGlobalConfig.mockClear()
  saveKnownMarketplacesConfig.mockClear()
  fetchOfficialMarketplaceFromGcs.mockClear()
  fetchOfficialMarketplaceFromGcs.mockImplementation(async () => 'sha')
  addMarketplaceSource.mockClear()
})

describe('checkAndInstallOfficialMarketplace', () => {
  test('repairs missing known marketplace even when global config says installed', async () => {
    config = {
      officialMarketplaceAutoInstallAttempted: true,
      officialMarketplaceAutoInstalled: true,
    }

    const result = await checkAndInstallOfficialMarketplace()

    expect(result).toEqual({ installed: true, skipped: false })
    expect(fetchOfficialMarketplaceFromGcs).toHaveBeenCalled()
    expect(saveKnownMarketplacesConfig).toHaveBeenCalled()
    expect(knownMarketplaces).toHaveProperty('claude-plugins-official')
    expect(config.officialMarketplaceAutoInstalled).toBe(true)
    expect(config.officialMarketplaceAutoInstallFailReason).toBeUndefined()
  })

  test('uses known marketplaces as the installed source of truth', async () => {
    knownMarketplaces = {
      'claude-plugins-official': {
        installLocation: '/tmp/openclaude-marketplaces/claude-plugins-official',
      },
    }

    const result = await checkAndInstallOfficialMarketplace()

    expect(result).toEqual({
      installed: false,
      skipped: true,
      reason: 'already_installed',
    })
    expect(fetchOfficialMarketplaceFromGcs).not.toHaveBeenCalled()
    expect(config.officialMarketplaceAutoInstallAttempted).toBe(true)
    expect(config.officialMarketplaceAutoInstalled).toBe(true)
  })
})
