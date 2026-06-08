import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// We test copilotOptimization functions by mocking the provider module.
// The module reads getAPIProvider() at call time, so we swap it per test.

type ProvidersModule = typeof import('./model/providers.js')
type CopilotOptimizationModule = typeof import('./copilotOptimization.js')

let actualProvidersModule: ProvidersModule | undefined
let actualCopilotOptimizationModule: CopilotOptimizationModule | undefined

async function getModules(): Promise<CopilotOptimizationModule> {
  if (!actualCopilotOptimizationModule) {
    actualCopilotOptimizationModule = await import(
      `./copilotOptimization.ts?copilotOptTest=${Date.now()}-${Math.random()}`
    )
  }
  return actualCopilotOptimizationModule!
}

function setProvider(provider: string) {
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => provider,
    // Provide minimal exports to avoid import errors
    isGithubNativeAnthropicMode: () => false,
    getProviderForModel: () => 'github',
    getModelProvider: () => 'github',
  }))
}

beforeEach(() => {
  // Reset env for each test
  delete process.env.GITHUB_COPILOT_MAX_SUBAGENTS
  delete process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS
  delete process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS
  delete process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED
})

afterEach(() => {
  mock.restore()
})

describe('isGitHubCopilotMode', () => {
  test('returns true when provider is github', async () => {
    setProvider('github')
    const { isGitHubCopilotMode } = await getModules()
    expect(isGitHubCopilotMode()).toBe(true)
  })

  test('returns false for other providers', async () => {
    setProvider('anthropic')
    const { isGitHubCopilotMode } = await getModules()
    expect(isGitHubCopilotMode()).toBe(false)
  })
})

describe('isCopilotPremiumOptimizationEnabled', () => {
  test('returns false when not in GitHub Copilot mode', async () => {
    setProvider('anthropic')
    const { isCopilotPremiumOptimizationEnabled } = await getModules()
    expect(isCopilotPremiumOptimizationEnabled()).toBe(false)
  })

  test('returns true by default in GitHub Copilot mode', async () => {
    setProvider('github')
    const { isCopilotPremiumOptimizationEnabled } = await getModules()
    expect(isCopilotPremiumOptimizationEnabled()).toBe(true)
  })

  test('returns false when GITHUB_COPILOT_OPTIMIZATION_DISABLED=1', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED = '1'
    const { isCopilotPremiumOptimizationEnabled } = await getModules()
    expect(isCopilotPremiumOptimizationEnabled()).toBe(false)
  })
})

describe('getCopilotMaxConcurrentSubagents', () => {
  test('returns 0 when not in Copilot mode', async () => {
    setProvider('anthropic')
    const { getCopilotMaxConcurrentSubagents } = await getModules()
    expect(getCopilotMaxConcurrentSubagents()).toBe(0)
  })

  test('returns 1 by default in Copilot mode', async () => {
    setProvider('github')
    const { getCopilotMaxConcurrentSubagents } = await getModules()
    expect(getCopilotMaxConcurrentSubagents()).toBe(1)
  })

  test('returns parsed value from GITHUB_COPILOT_MAX_SUBAGENTS', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '3'
    const { getCopilotMaxConcurrentSubagents } = await getModules()
    expect(getCopilotMaxConcurrentSubagents()).toBe(3)
  })

  test('returns 0 when GITHUB_COPILOT_MAX_SUBAGENTS=0', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    const { getCopilotMaxConcurrentSubagents } = await getModules()
    expect(getCopilotMaxConcurrentSubagents()).toBe(0)
  })

  test('clamps to MAX_REASONABLE_SUBAGENTS (10)', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '100'
    const { getCopilotMaxConcurrentSubagents } = await getModules()
    expect(getCopilotMaxConcurrentSubagents()).toBe(10)
  })
})

describe('shouldSuppressSubagentsInCopilotMode', () => {
  test('returns false when not in Copilot mode', async () => {
    setProvider('anthropic')
    const { shouldSuppressSubagentsInCopilotMode } = await getModules()
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })

  test('returns false when optimization is disabled', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED = '1'
    const { shouldSuppressSubagentsInCopilotMode } = await getModules()
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })

  test('returns false when GITHUB_COPILOT_ALLOW_SUBAGENTS=1', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    const { shouldSuppressSubagentsInCopilotMode } = await getModules()
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })

  test('returns true when MAX_SUBAGENTS=0', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    const { shouldSuppressSubagentsInCopilotMode } = await getModules()
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(true)
  })

  test('returns false when MAX_SUBAGENTS=1 (default)', async () => {
    setProvider('github')
    const { shouldSuppressSubagentsInCopilotMode } = await getModules()
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })
})

describe('shouldForceSyncSubagentsInCopilotMode', () => {
  test('returns false when not in Copilot mode', async () => {
    setProvider('anthropic')
    const { shouldForceSyncSubagentsInCopilotMode } = await getModules()
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })

  test('returns false when optimization is disabled', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED = '1'
    const { shouldForceSyncSubagentsInCopilotMode } = await getModules()
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })

  test('returns true when GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS=1', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS = '1'
    const { shouldForceSyncSubagentsInCopilotMode } = await getModules()
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })

  test('returns false when GITHUB_COPILOT_ALLOW_SUBAGENTS=1', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    const { shouldForceSyncSubagentsInCopilotMode } = await getModules()
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })

  test('returns true by default in Copilot mode (cap=1 > 0)', async () => {
    setProvider('github')
    const { shouldForceSyncSubagentsInCopilotMode } = await getModules()
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })

  test('returns true when cap > 0 (e.g. 3)', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '3'
    const { shouldForceSyncSubagentsInCopilotMode } = await getModules()
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })

  test('returns false when cap = 0', async () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    const { shouldForceSyncSubagentsInCopilotMode } = await getModules()
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })
})
