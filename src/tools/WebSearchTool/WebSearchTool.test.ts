import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

function setupOpenAIEnv() {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_API_KEY = 'test-openai-key'
  process.env.OPENAI_MODEL = 'claude-sonnet-4'
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_GEMINI
}

async function loadTool() {
  const mod = await import(`./WebSearchTool.ts?t=${Date.now()}-${Math.random()}`)
  return mod.WebSearchTool
}

type SearchLinkBlock = {
  tool_use_id: string
  content: Array<{ title: string; url: string }>
}

function createCallContext() {
  return {
    abortController: new AbortController(),
  } as never
}

beforeEach(() => {
  process.env = { ...originalEnv }
  globalThis.fetch = originalFetch
})

afterEach(() => {
  process.env = { ...originalEnv }
  globalThis.fetch = originalFetch
  mock.restore()
})

describe('WebSearchTool Exa contracts', () => {
  test(
    'is enabled when EXA_API_KEY is set for non-native openai provider path',
    async () => {
    process.env.EXA_API_KEY = 'exa_test_key'
    setupOpenAIEnv()

    const WebSearchTool = await loadTool()

    expect(WebSearchTool.isEnabled()).toBe(true)
    },
    30000,
  )

  test('prompt removes US-only restriction when Exa backend is available', async () => {
    process.env.EXA_API_KEY = 'exa_test_key'
    setupOpenAIEnv()

    const WebSearchTool = await loadTool()
    const prompt = await WebSearchTool.prompt()

    expect(prompt).not.toContain('Web search is only available in the US')
  })

  test('calls Exa search endpoint with includeDomains mapped from allowed_domains', async () => {
    process.env.EXA_API_KEY = 'exa_test_key'
    setupOpenAIEnv()

    const fetchSpy = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      expect(url).toBe('https://api.exa.ai/search')

      const headers = init?.headers as Record<string, string>
      expect(headers['x-api-key']).toBe('exa_test_key')
      expect(headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(String(init?.body))
      expect(body.query).toBe('latest bun release notes')
      expect(body.includeDomains).toEqual(['example.com'])
      expect(body.excludeDomains).toBeUndefined()
      expect(body.type).toBe('auto')
      expect(body.contents?.highlights?.maxCharacters).toBe(4000)

      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Example Docs',
                url: 'https://example.com/docs',
                highlights: ['Bun 1.x release details.'],
              },
            ],
          }),
          { status: 200 },
        ),
      )
    })

    globalThis.fetch = fetchSpy as typeof globalThis.fetch

    const WebSearchTool = await loadTool()
    const result = await WebSearchTool.call(
      {
        query: 'latest bun release notes',
        allowed_domains: ['example.com'],
      },
      createCallContext(),
      async () => true,
      {} as never,
      undefined,
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const data = result.data
    expect(data.query).toBe('latest bun release notes')

    const textResult = data.results.find((r: unknown) => typeof r === 'string')
    expect(typeof textResult).toBe('string')
    expect(String(textResult)).toContain('Bun 1.x release details.')

    const linkBlock = data.results.find(
      (r: unknown) => typeof r === 'object' && r !== null,
    ) as SearchLinkBlock

    expect(linkBlock.tool_use_id).toBe('exa-search')
    expect(linkBlock.content).toEqual([
      { title: 'Example Docs', url: 'https://example.com/docs' },
    ])
  })

  test('maps blocked_domains to excludeDomains and returns a graceful message on Exa auth failure', async () => {
    process.env.EXA_API_KEY = 'bad_key'
    setupOpenAIEnv()

    const fetchSpy = mock((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.excludeDomains).toEqual(['example.com'])
      expect(body.includeDomains).toBeUndefined()

      return Promise.resolve(new Response('invalid api key', { status: 401 }))
    })

    globalThis.fetch = fetchSpy as typeof globalThis.fetch

    const WebSearchTool = await loadTool()

    const result = await WebSearchTool.call(
      {
        query: 'latest ai policy updates',
        blocked_domains: ['example.com'],
      },
      createCallContext(),
      async () => true,
      {} as never,
      undefined,
    )

    expect(result.data.query).toBe('latest ai policy updates')
    expect(result.data.results).toContain(
      'Web search temporarily unavailable — verify EXA_API_KEY or try again shortly.',
    )
  })

  test('prefers Exa when both EXA_API_KEY and FIRECRAWL_API_KEY are set', async () => {
    process.env.EXA_API_KEY = 'exa_test_key'
    process.env.FIRECRAWL_API_KEY = 'firecrawl_key'
    setupOpenAIEnv()

    const fetchSpy = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Exa Source',
                url: 'https://exa.ai/docs',
                highlights: ['Source from Exa.'],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    globalThis.fetch = fetchSpy as typeof globalThis.fetch

    const WebSearchTool = await loadTool()
    const result = await WebSearchTool.call(
      {
        query: 'exa docs',
      },
      createCallContext(),
      async () => true,
      {} as never,
      undefined,
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.data.results).toContainEqual({
      tool_use_id: 'exa-search',
      content: [{ title: 'Exa Source', url: 'https://exa.ai/docs' }],
    })
  })
})
