import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

// @ts-expect-error -- query-string cache-buster: the `?...` suffix makes Bun
// treat this as a distinct module id, bypassing other suites'
// mock.module('../utils/settings/settings.js') registrations so we capture the
// genuine module. Importing it at module scope (once) keeps the real-module
// load out of beforeEach, where the cold dynamic import sat right at Bun's 5s
// hook-timeout boundary.
import * as realSettingsModule from '../utils/settings/settings.js?modelLimitsRealSettings'

// Integration coverage for the `modelLimits` settings override flowing through
// the real runtime resolution path (CodeRabbit review on PR #1164/#1234). The
// per-symbol tests in openaiContextWindows.test.ts exercise the lookup helpers
// directly; this drives the full chain via resolveModelRuntimeLimits, which is
// what runtime code actually calls. It also confirms the settings fallback is
// reached (resolveModelRuntimeLimits calls the settings-aware
// getOpenAIContextWindowMatches / getOpenAIMaxOutputTokenMatches, not a
// settings-blind variant) for prefix and host-qualified keys, and that env
// overrides win.

type SettingsShape = {
  modelLimits?: Record<
    string,
    { contextWindow?: number; maxOutputTokens?: number }
  >
}

let mockSettings: SettingsShape = {}
// Gate the getInitialSettings override so the process-global mock.module is a
// transparent passthrough to the real settings whenever this suite is not the
// one running — otherwise a later integrations test that reads
// getInitialSettings() would see this suite's stub settings leak in.
let settingsOverrideActive = false

beforeEach(async () => {
  await acquireSharedMutationLock('integrations/runtimeMetadata.modelLimits.test.ts')
  mock.restore()
  mockSettings = {}
  mock.module('../utils/settings/settings.js', () => ({
    ...realSettingsModule,
    getInitialSettings: () =>
      settingsOverrideActive
        ? mockSettings
        : realSettingsModule.getInitialSettings(),
  }))
  settingsOverrideActive = true
})

afterEach(() => {
  try {
    mock.restore()
    settingsOverrideActive = false
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFresh() {
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./runtimeMetadata.js?ts=${nonce}`)
}

test('resolveModelRuntimeLimits resolves settings modelLimits for an exact model key', async () => {
  mockSettings = {
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
  mockSettings = {
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
  mockSettings = {
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
  mockSettings = {
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

test('resolveModelRuntimeLimits lets a broad env-prefix override win over an exact settings key', async () => {
  // Regression for the env/settings precedence drift: a broad env-prefix
  // override (`my-custom`) must not be silently overtaken by a more specific
  // settings entry (`my-custom-deployment`). Covers both contextWindow and
  // maxOutputTokens.
  mockSettings = {
    modelLimits: {
      'my-custom-deployment': { contextWindow: 999, maxOutputTokens: 111 },
    },
  }
  const { resolveModelRuntimeLimits } = await importFresh()

  const limits = resolveModelRuntimeLimits({
    model: 'my-custom-deployment',
    processEnv: {
      CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({
        'my-custom': 111_111,
      }),
      CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS: JSON.stringify({
        'my-custom': 4_096,
      }),
    },
  })

  expect(limits.contextWindow).toBe(111_111)
  expect(limits.maxOutputTokens).toBe(4_096)
})
