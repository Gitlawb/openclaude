import { beforeEach, describe, expect, mock, test } from 'bun:test'

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

mock.module('../../services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => true,
}))

mock.module('../../services/analytics/index.js', () => ({
  logEvent: mock(() => {}),
}))

mock.module('../config.js', () => ({
  getGlobalConfig: () => config,
  saveGlobalConfig,
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
  getMarketplacesCacheDir: () => '/tmp/openclaude-marketplaces',
  loadKnownMarketplacesConfig: async () => knownMarketplaces,
  saveKnownMarketplacesConfig,
}))

mock.module('./officialMarketplaceGcs.js', () => ({
  fetchOfficialMarketplaceFromGcs,
}))

const { checkAndInstallOfficialMarketplace } = await import(
  './officialMarketplaceStartupCheck.js'
)

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
