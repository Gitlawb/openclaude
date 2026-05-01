import { afterEach, describe, expect, test } from 'bun:test'

import { get } from './models.js'

type FetchType = typeof globalThis.fetch

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('github-copilot models', () => {
  test('includes models even when model_picker_enabled is false', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: false,
              id: 'search-agent-a',
              name: 'Search Agent A',
              version: 'search-agent-a-2026-04-01',
              policy: { state: 'enabled' },
              capabilities: {
                family: 'agent',
                limits: {
                  max_context_window_tokens: 200000,
                  max_prompt_tokens: 200000,
                  max_output_tokens: 4096,
                },
                supports: {
                  tool_calls: true,
                },
              },
            },
            {
              model_picker_enabled: false,
              id: 'embedding-v3-small',
              name: 'Embedding V3 Small',
              version: 'embedding-v3-small-2026-04-01',
              policy: { state: 'enabled' },
              capabilities: {
                family: 'embedding',
                limits: {
                  max_context_window_tokens: 8192,
                  max_prompt_tokens: 8192,
                  max_output_tokens: 1,
                },
                supports: {},
              },
            },
          ],
        }),
      )) as FetchType

    const models = await get('https://api.githubcopilot.com')

    expect(models['search-agent-a']).toBeDefined()
    expect(models['search-agent-a']?.name).toBe('Search Agent A')
    expect(models['embedding-v3-small']).toBeDefined()
    expect(models['embedding-v3-small']?.name).toBe('Embedding V3 Small')
  })

  test('excludes models explicitly disabled by policy', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: 'allowed-model',
              name: 'Allowed Model',
              version: 'allowed-model-2026-04-01',
              policy: { state: 'enabled' },
              capabilities: {
                family: 'chat',
                limits: {
                  max_context_window_tokens: 8192,
                  max_prompt_tokens: 8192,
                  max_output_tokens: 4096,
                },
                supports: {},
              },
            },
            {
              model_picker_enabled: true,
              id: 'disabled-model',
              name: 'Disabled Model',
              version: 'disabled-model-2026-04-01',
              policy: { state: 'disabled' },
              capabilities: {
                family: 'chat',
                limits: {
                  max_context_window_tokens: 8192,
                  max_prompt_tokens: 8192,
                  max_output_tokens: 4096,
                },
                supports: {},
              },
            },
          ],
        }),
      )) as FetchType

    const models = await get('https://api.githubcopilot.com')

    expect(models['allowed-model']).toBeDefined()
    expect(models['disabled-model']).toBeUndefined()
  })
})
