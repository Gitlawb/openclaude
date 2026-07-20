import { describe, expect, test } from 'bun:test'

import { shouldCompressNativeToolHistory } from './claude.js'

// The routing decision queryModel applies before mutating request messages:
// every Anthropic-native transport compresses tool history ONLY while prompt
// caching is inactive, and never for shim-routed providerOverride requests.
// Parameterized here because the predicate guards a request-mutating branch
// across four transports and two exclusions.

const NATIVE_CASES = [
  { apiProvider: 'firstParty', isGithubNativeAnthropic: false },
  { apiProvider: 'bedrock', isGithubNativeAnthropic: false },
  { apiProvider: 'vertex', isGithubNativeAnthropic: false },
  // GitHub-native-Anthropic reports its own provider id; the mode flag is
  // what marks it native.
  { apiProvider: 'github', isGithubNativeAnthropic: true },
] as const

describe('shouldCompressNativeToolHistory', () => {
  for (const transport of NATIVE_CASES) {
    const name = transport.isGithubNativeAnthropic
      ? `${transport.apiProvider} (native-Anthropic mode)`
      : transport.apiProvider

    test(`${name}: compresses with caching off`, () => {
      expect(
        shouldCompressNativeToolHistory({
          ...transport,
          hasProviderOverride: false,
          promptCachingEnabled: false,
        }),
      ).toBe(true)
    })

    test(`${name}: cached sessions stay unmodified`, () => {
      expect(
        shouldCompressNativeToolHistory({
          ...transport,
          hasProviderOverride: false,
          promptCachingEnabled: true,
        }),
      ).toBe(false)
    })

    test(`${name}: providerOverride requests are shim-routed, never compressed here`, () => {
      expect(
        shouldCompressNativeToolHistory({
          ...transport,
          hasProviderOverride: true,
          promptCachingEnabled: false,
        }),
      ).toBe(false)
    })
  }

  test('non-native providers never compress at this layer, cached or not', () => {
    for (const apiProvider of ['openai', 'codex', 'gemini', 'minimax', 'xai']) {
      for (const promptCachingEnabled of [false, true]) {
        expect(
          shouldCompressNativeToolHistory({
            apiProvider,
            isGithubNativeAnthropic: false,
            hasProviderOverride: false,
            promptCachingEnabled,
          }),
        ).toBe(false)
      }
    }
  })
})
