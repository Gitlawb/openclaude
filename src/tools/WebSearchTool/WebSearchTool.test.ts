import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  getMainLoopModelOverride,
  setMainLoopModelOverride,
} from '../../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import * as searchProviders from './providers/index.js'
import type { ProviderOutput } from './providers/types.js'
import { __test, WebSearchTool } from './WebSearchTool.js'

const {
  buildEmptyAdapterResultHint,
  formatProviderOutputWithEmptyHint,
  buildAdapterUnavailableError,
} = __test

describe('Vertex native search availability', () => {
  let previousEnv: NodeJS.ProcessEnv
  let previousModel: ReturnType<typeof getMainLoopModelOverride>
  let availableProviders: ReturnType<typeof spyOn<typeof searchProviders, 'getAvailableProviders'>>

  beforeEach(async () => {
    await acquireSharedMutationLock('WebSearchTool native availability')
    previousEnv = process.env
    previousModel = getMainLoopModelOverride()
    process.env = { CLAUDE_CODE_USE_VERTEX: '1', WEB_SEARCH_PROVIDER: 'native' }
    availableProviders = spyOn(searchProviders, 'getAvailableProviders').mockReturnValue([])
  })

  afterEach(() => {
    availableProviders.mockRestore()
    setMainLoopModelOverride(previousModel)
    process.env = previousEnv
    releaseSharedMutationLock()
  })

  test.each([
    ['claude-sonnet-5', true],
    ['claude-sonnet-50', false],
  ] as const)('%s native search is enabled: %s', (model, enabled) => {
    setMainLoopModelOverride(model)
    expect(WebSearchTool.isEnabled()).toBe(enabled)
  })
})

describe('buildEmptyAdapterResultHint', () => {
  test('names the active provider and the failing backend', () => {
    const msg = buildEmptyAdapterResultHint('minimax', 'duckduckgo')
    expect(msg).toContain('minimax')
    expect(msg).toContain('duckduckgo')
  })

  test('includes the actionable env-var list so the user can pick one', () => {
    const msg = buildEmptyAdapterResultHint('moonshot', 'duckduckgo')
    for (const key of [
      'FIRECRAWL_API_KEY',
      'TAVILY_API_KEY',
      'EXA_API_KEY',
      'JINA_API_KEY',
      'BING_API_KEY',
      'MOJEEK_API_KEY',
      'LINKUP_API_KEY',
      'YOU_API_KEY',
    ]) {
      expect(msg).toContain(key)
    }
  })

  test('mentions the native-provider escape hatch', () => {
    const msg = buildEmptyAdapterResultHint('nvidia-nim', 'duckduckgo')
    expect(msg).toMatch(/Anthropic/)
    expect(msg).toMatch(/Vertex/)
    expect(msg).toMatch(/Foundry/)
  })
})

describe('formatProviderOutputWithEmptyHint', () => {
  test('replaces the empty placeholder with a diagnostic when 0 hits', () => {
    const po: ProviderOutput = {
      hits: [],
      providerName: 'duckduckgo',
      durationSeconds: 0.42,
    }
    const out = formatProviderOutputWithEmptyHint(po, 'cat facts', 'minimax')
    expect(out.results.length).toBe(1)
    expect(out.results[0]).toMatch(/^No results from "duckduckgo"/)
    expect(out.durationSeconds).toBe(0.42)
    expect(out.query).toBe('cat facts')
  })

  test('does not mutate the result when hits are present', () => {
    const po: ProviderOutput = {
      hits: [
        {
          title: 'Cats',
          url: 'https://example.com/cats',
          description: 'About cats.',
        },
      ],
      providerName: 'duckduckgo',
      durationSeconds: 1.2,
    }
    const out = formatProviderOutputWithEmptyHint(po, 'cat facts', 'minimax')
    // hits-present case is delegated to the unmodified formatProviderOutput
    // path, so the snippet block + tool_use_id are preserved.
    expect(out.results.length).toBe(2)
    expect(typeof out.results[0]).toBe('string')
    expect(out.results[0]).toContain('Cats')
    expect(out.results[0]).toContain('https://example.com/cats')
  })
})

// Regression for #994: when the adapter path fails in auto mode on an
// openai-shim provider with NO native web-search fallback (moonshot, minimax,
// nvidia-nim, github copilot, etc.), the user must see the underlying adapter
// failure embedded in the thrown error instead of getting "Did 0 searches"
// from a silent fall-through to the native path. This is the only reachable
// surfacing path under the current `shouldUseAdapterProvider()` /
// `hasNativeSearchFallback()` semantics — auto mode prefers native whenever
// it exists, so the "adapter tried then native ran" config is not actually
// invoked today.
describe('buildAdapterUnavailableError', () => {
  test('names the active provider', () => {
    const msg = buildAdapterUnavailableError('minimax', 'rate limited')
    expect(msg).toContain('minimax')
  })

  test('embeds the underlying adapter error message verbatim', () => {
    const msg = buildAdapterUnavailableError(
      'moonshot',
      'duckduckgo: 429 Too Many Requests',
    )
    expect(msg).toContain('duckduckgo: 429 Too Many Requests')
  })

  test('points the user at a working native-search provider', () => {
    const msg = buildAdapterUnavailableError('nvidia-nim', 'timeout')
    expect(msg).toMatch(/Anthropic/)
    expect(msg).toMatch(/Codex/)
  })
})
