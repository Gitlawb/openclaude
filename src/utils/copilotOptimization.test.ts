import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

// Spy on the real providers module's getAPIProvider instead of replacing
// the entire module with a partial mock. Replacing the whole module via
// mock.module() removed all other exports (e.g. isFirstPartyAnthropicBaseUrl,
// resolveActiveRouteIdFromEnv), which broke downstream tests in the same
// CI process that import those symbols. spyOn preserves the module's
// real exports and overrides only getAPIProvider per test.

import * as providers from './model/providers.js'
import {
  isGitHubCopilotMode,
  isCopilotPremiumOptimizationEnabled,
  getCopilotMaxConcurrentSubagents,
  shouldSuppressSubagentsInCopilotMode,
  shouldForceSyncSubagentsInCopilotMode,
} from './copilotOptimization.js'

let getAPIProviderSpy: ReturnType<typeof spyOn<typeof providers, 'getAPIProvider'>>

// Capture the GITHUB_COPILOT_* env vars at module top-level so the afterEach
// can restore them. Without this, the precedence test (which sets
// FORCE_SYNC=1 + ALLOW_SUBAGENTS=1) would leave those env vars in process.env
// after the file finishes, and any later same-process Bun test (e.g. an
// `AgentTool.routing.test.ts` reading `isGitHubCopilotMode()` live) would
// exercise the forced-sync path accidentally. Verified by running
// `bun test src/utils/copilotOptimization.test.ts ../copilot-env-probe.test.ts`
// — without this restoration, the probe test sees FORCE_SYNC=1 leaked.
const ORIGINAL_COPILOT_ENV: Record<string, string | undefined> = {
  GITHUB_COPILOT_MAX_SUBAGENTS: process.env.GITHUB_COPILOT_MAX_SUBAGENTS,
  GITHUB_COPILOT_ALLOW_SUBAGENTS: process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS,
  GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS:
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS,
  GITHUB_COPILOT_OPTIMIZATION_DISABLED:
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED,
}

function setProvider(provider: string): void {
  getAPIProviderSpy.mockReturnValue(
    provider as ReturnType<typeof providers.getAPIProvider>,
  )
}

beforeEach(() => {
  // Default to anthropic; individual tests override to 'github' as needed.
  getAPIProviderSpy = spyOn(providers, 'getAPIProvider').mockReturnValue(
    'anthropic' as ReturnType<typeof providers.getAPIProvider>,
  )
  // Reset env for each test
  delete process.env.GITHUB_COPILOT_MAX_SUBAGENTS
  delete process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS
  delete process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS
  delete process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED
})

afterEach(() => {
  getAPIProviderSpy.mockRestore()
  // Restore the env vars to their pre-file values. The afterEach ordering
  // matters: mockRestore() must run first so the provider detection below
  // (which reads `isGitHubCopilotMode()` via the real module) sees a
  // consistent post-test env state.
  for (const [key, value] of Object.entries(ORIGINAL_COPILOT_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('isGitHubCopilotMode', () => {
  test('returns true when provider is github', () => {
    setProvider('github')
    expect(isGitHubCopilotMode()).toBe(true)
  })

  test('returns false for other providers', () => {
    setProvider('anthropic')
    expect(isGitHubCopilotMode()).toBe(false)
  })
})

describe('isCopilotPremiumOptimizationEnabled', () => {
  test('returns false when not in GitHub Copilot mode', () => {
    setProvider('anthropic')
    expect(isCopilotPremiumOptimizationEnabled()).toBe(false)
  })

  test('returns true by default in GitHub Copilot mode', () => {
    setProvider('github')
    expect(isCopilotPremiumOptimizationEnabled()).toBe(true)
  })

  test('returns false when GITHUB_COPILOT_OPTIMIZATION_DISABLED=1', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED = '1'
    expect(isCopilotPremiumOptimizationEnabled()).toBe(false)
  })
})

describe('getCopilotMaxConcurrentSubagents', () => {
  test('returns 0 when not in Copilot mode', () => {
    setProvider('anthropic')
    expect(getCopilotMaxConcurrentSubagents()).toBe(0)
  })

  test('returns 1 by default in Copilot mode', () => {
    setProvider('github')
    expect(getCopilotMaxConcurrentSubagents()).toBe(1)
  })

  test('returns parsed value from GITHUB_COPILOT_MAX_SUBAGENTS', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '3'
    expect(getCopilotMaxConcurrentSubagents()).toBe(3)
  })

  test('returns 0 when GITHUB_COPILOT_MAX_SUBAGENTS=0', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    expect(getCopilotMaxConcurrentSubagents()).toBe(0)
  })

  test('clamps to MAX_REASONABLE_SUBAGENTS (10)', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '100'
    expect(getCopilotMaxConcurrentSubagents()).toBe(10)
  })
})

describe('shouldSuppressSubagentsInCopilotMode', () => {
  test('returns false when not in Copilot mode', () => {
    setProvider('anthropic')
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })

  test('returns false when optimization is disabled', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED = '1'
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })

  test('returns false when GITHUB_COPILOT_ALLOW_SUBAGENTS=1', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })

  test('returns true when MAX_SUBAGENTS=0', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(true)
  })

  test('returns false when MAX_SUBAGENTS=0 but FORCE_SYNC_SUBAGENTS=1', () => {
    // FORCE_SYNC means "run sub-agents synchronously", which must win over the
    // MAX_SUBAGENTS=0 suppression — otherwise the agent throws "Sub-agents are
    // disabled" instead of running one at a time, contradicting the documented
    // "takes precedence over MAX_SUBAGENTS=0" behavior.
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS = '1'
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
    // ...and the agent is then routed down the synchronous path.
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })

  test('returns false when MAX_SUBAGENTS=1 (default)', () => {
    setProvider('github')
    expect(shouldSuppressSubagentsInCopilotMode()).toBe(false)
  })
})

describe('shouldForceSyncSubagentsInCopilotMode', () => {
  test('returns false when not in Copilot mode', () => {
    setProvider('anthropic')
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })

  test('returns false when optimization is disabled', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED = '1'
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })

  test('returns true when GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS=1', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS = '1'
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })

  test('returns false when GITHUB_COPILOT_ALLOW_SUBAGENTS=1', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })

  test('returns true by default in Copilot mode (cap=1 > 0)', () => {
    setProvider('github')
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })

  test('returns true when cap > 0 (e.g. 3)', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '3'
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })

  test('returns false when cap = 0', () => {
    setProvider('github')
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(false)
  })

  test('FORCE_SYNC=1 overrides ALLOW_SUBAGENTS=1', () => {
    // CodeRabbit round 9: regression test for precedence. When both
    // opt-out flags are set, FORCE_SYNC must win — the user explicitly
    // asked for synchronous execution, and ALLOW_SUBAGENTS is only a
    // softer "I'm fine with the cap, don't drop me" hint. A future
    // reordering of these checks in shouldForceSyncSubagentsInCopilotMode()
    // would silently allow parallel Copilot sub-agent launches when the
    // user asked for sync; lock the precedence here.
    setProvider('github')
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS = '1'
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    expect(shouldForceSyncSubagentsInCopilotMode()).toBe(true)
  })
})
