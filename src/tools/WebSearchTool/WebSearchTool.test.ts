import { describe, expect, test } from 'bun:test'
import type { ProviderOutput } from './providers/types.js'
import { __test } from './WebSearchTool.js'

const {
  buildEmptyAdapterResultHint,
  formatProviderOutputWithEmptyHint,
  withAdapterFallthroughNotice,
} = __test

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

  test('returns input unchanged when no notice is supplied', () => {
    const out = {
      query: 'cat facts',
      results: ['existing string'],
      durationSeconds: 0.5,
    }
    expect(withAdapterFallthroughNotice(out, undefined)).toBe(out)
  })

  // Regression for #994: when the adapter path (DDG / Firecrawl / Tavily / etc.)
  // fails in auto mode and we fall through to native/Codex search, the user
  // must see *why* the adapter failed instead of getting "no results found"
  // with no explanation. The notice gets prepended to the results array.
  test('prepends notice when the adapter path failed before native search ran', () => {
    const out = {
      query: 'cat facts',
      results: ['native result text'],
      durationSeconds: 1.1,
    }
    const result = withAdapterFallthroughNotice(
      out,
      'Web search adapter failed before falling back to native search: rate-limited',
    )
    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatch(/^Web search adapter failed/)
    expect(result.results[1]).toBe('native result text')
    expect(result.query).toBe(out.query)
    expect(result.durationSeconds).toBe(out.durationSeconds)
    // Input is not mutated.
    expect(out.results).toHaveLength(1)
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
