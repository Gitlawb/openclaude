import { afterEach, expect, test } from 'bun:test'

const originalEnv = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}

const originalFetch = globalThis.fetch

async function importFreshGithubModelsModule() {
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./githubModels.js?ts=${nonce}`)
}

afterEach(() => {
  if (originalEnv.GITHUB_TOKEN === undefined) {
    delete process.env.GITHUB_TOKEN
  } else {
    process.env.GITHUB_TOKEN = originalEnv.GITHUB_TOKEN
  }

  if (originalEnv.GH_TOKEN === undefined) {
    delete process.env.GH_TOKEN
  } else {
    process.env.GH_TOKEN = originalEnv.GH_TOKEN
  }

  if (originalEnv.OPENAI_BASE_URL === undefined) {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  }

  globalThis.fetch = originalFetch
})

test('fetchGithubModels uses Copilot /models endpoint and filters disabled models', async () => {
  process.env.GITHUB_TOKEN = 'test-token'
  delete process.env.OPENAI_BASE_URL

  let calledUrl = ''
  let calledHeaders: Headers | undefined
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calledUrl = String(input)
    calledHeaders = new Headers(init?.headers)
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'openai/gpt-5-mini',
            name: 'GPT-5 mini',
            summary: 'Fast and cheap',
            model_picker_enabled: true,
            policy: { state: 'enabled' },
          },
          {
            id: 'anthropic/claude-sonnet-4-6',
            name: 'Claude Sonnet 4.6',
            model_picker_enabled: true,
            policy: { state: 'disabled' },
          },
          {
            id: 'openai/gpt-4.1',
            name: 'GPT-4.1',
            model_picker_enabled: false,
            policy: { state: 'enabled' },
          },
        ],
      }),
      { status: 200 },
    )
  }) as typeof fetch

  const { fetchGithubModels } = await importFreshGithubModelsModule()
  const models = await fetchGithubModels()

  expect(calledUrl).toBe('https://api.githubcopilot.com/models')
  expect(calledHeaders?.get('editor-version')).toBe('vscode/1.99.3')
  expect(calledHeaders?.get('editor-plugin-version')).toBe('copilot-chat/0.26.7')
  expect(calledHeaders?.get('copilot-integration-id')).toBe('vscode-chat')
  expect(calledHeaders?.get('x-github-api-version')).toBeNull()
  expect(models).toHaveLength(1)
  expect(models[0]).toEqual({
    value: 'openai/gpt-5-mini',
    label: 'GPT-5 mini',
    description: 'GitHub Models · Fast and cheap',
  })
})

test('fetchGithubModels accepts api.githubcopilot.com custom base URL and uses its origin', async () => {
  process.env.GITHUB_TOKEN = 'test-token'
  process.env.OPENAI_BASE_URL =
    'https://api.githubcopilot.com/v1/chat/completions'

  let calledUrl = ''
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    calledUrl = String(input)
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }) as typeof fetch

  const { fetchGithubModels } = await importFreshGithubModelsModule()
  await fetchGithubModels()

  expect(calledUrl).toBe('https://api.githubcopilot.com/models')
})

test('fetchGithubModels falls back to Copilot endpoint when OPENAI_BASE_URL is models.github.ai', async () => {
  process.env.GITHUB_TOKEN = 'test-token'
  process.env.OPENAI_BASE_URL = 'https://models.github.ai/inference'

  let calledUrl = ''
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    calledUrl = String(input)
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }) as typeof fetch

  const { fetchGithubModels } = await importFreshGithubModelsModule()
  await fetchGithubModels()

  expect(calledUrl).toBe('https://api.githubcopilot.com/models')
})

test('refreshGithubModelsCache deduplicates in-flight fetch and updates cache', async () => {
  process.env.GITHUB_TOKEN = 'test-token'

  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'openai/gpt-5-mini',
            name: 'GPT-5 mini',
            model_picker_enabled: true,
            policy: { state: 'enabled' },
          },
        ],
      }),
      { status: 200 },
    )
  }) as typeof fetch

  const {
    refreshGithubModelsCache,
    getCachedGithubModelOptions,
  } = await importFreshGithubModelsModule()

  const [first, second] = await Promise.all([
    refreshGithubModelsCache(),
    refreshGithubModelsCache(),
  ])

  expect(calls).toBe(1)
  expect(first).toHaveLength(1)
  expect(second).toHaveLength(1)
  expect(getCachedGithubModelOptions()).toHaveLength(1)
})
