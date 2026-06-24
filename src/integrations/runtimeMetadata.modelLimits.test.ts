import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

// Integration coverage for the `modelLimits` settings override flowing through
// the real runtime resolution path (CodeRabbit review on PR #1164/#1234). The
// per-symbol tests in openaiContextWindows.test.ts exercise the lookup helpers
// directly; this drives the full chain via resolveModelRuntimeLimits, which is
// what runtime code actually calls. It also confirms the settings fallback is
// reached (resolveModelRuntimeLimits calls the settings-aware
// getOpenAIContextWindow / getOpenAIMaxOutputTokens, not a settings-blind
// variant) for prefix and host-qualified keys, and that env overrides win.

type ConfigShape = {
  modelLimits?: Record<
    string,
    { contextWindow?: number; maxOutputTokens?: number } | null
  > | null
}

let mockConfig: ConfigShape = {}
// Gate the getGlobalConfig override so the process-global mock.module is a
// transparent passthrough to the real config whenever this suite is not the one
// running — otherwise a later integrations test that reads getGlobalConfig()
// would see this suite's stub config leak in.
let configOverrideActive = false
let realConfigModule: typeof import('../utils/config.js') | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('integrations/runtimeMetadata.modelLimits.test.ts')
  mock.restore()
  mockConfig = {}
  realConfigModule ??= (await import(
    `../utils/config.js?modelLimitsReal=${Date.now()}-${Math.random()}`
  )) as typeof import('../utils/config.js')
  const real = realConfigModule
  mock.module('../utils/config.js', () => ({
    ...real,
    getGlobalConfig: () =>
      configOverrideActive ? mockConfig : real.getGlobalConfig(),
  }))
  configOverrideActive = true
})

afterEach(() => {
  try {
    mock.restore()
    configOverrideActive = false
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFresh() {
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./runtimeMetadata.js?ts=${nonce}`)
}

test('resolveModelRuntimeLimits resolves settings modelLimits for an exact model key', async () => {
  mockConfig = {
    modelLimits: {
      'my-custom-deployment': { contextWindow: 123_456, maxOutputTokens: 4_096 },
    },
  }
  const { resolveModelRuntimeLimits } = await importFresh()

  const limits = resolveModelRuntimeLimits({
    model: 'my-custom-deployment',
    processEnv: {},
  })

  expect(limits.contextWindow).toBe(123_456)
  expect(limits.maxOutputTokens).toBe(4_096)
})

test('resolveModelRuntimeLimits prefers a host-qualified settings key', async () => {
  mockConfig = {
    modelLimits: {
      'my-custom-deployment': { contextWindow: 100_000 },
      'api.private-llm.test:my-custom-deployment': { contextWindow: 262_144 },
    },
  }
  const { resolveModelRuntimeLimits } = await importFresh()

  const limits = resolveModelRuntimeLimits({
    model: 'my-custom-deployment',
    baseUrl: 'https://api.private-llm.test/v1',
    processEnv: {},
  })

  expect(limits.contextWindow).toBe(262_144)
})

test('resolveModelRuntimeLimits resolves a prefix settings key', async () => {
  mockConfig = {
    modelLimits: {
      'my-custom': { contextWindow: 333_333 },
    },
  }
  const { resolveModelRuntimeLimits } = await importFresh()

  const limits = resolveModelRuntimeLimits({
    model: 'my-custom-deployment-v2',
    processEnv: {},
  })

  expect(limits.contextWindow).toBe(333_333)
})

test('resolveModelRuntimeLimits lets an env override win over settings modelLimits', async () => {
  mockConfig = {
    modelLimits: {
      'my-custom-deployment': { contextWindow: 999 },
    },
  }
  const { resolveModelRuntimeLimits } = await importFresh()

  const limits = resolveModelRuntimeLimits({
    model: 'my-custom-deployment',
    processEnv: {
      CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({
        'my-custom-deployment': 111_111,
      }),
    },
  })

  expect(limits.contextWindow).toBe(111_111)
})
