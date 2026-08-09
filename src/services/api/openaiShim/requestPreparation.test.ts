import { expect, test } from 'bun:test'
import { ensureIntegrationsLoaded } from '../../../integrations/index.js'
import { resolveProviderRequest } from '../providerConfig.js'
import { prepareOpenAIRequest } from './requestPreparation.js'

const convertedTools = [{
  type: 'function',
  function: {
    name: 'Read',
    description: 'Read a file',
    parameters: { type: 'object', properties: {} },
  },
}]

const dependencies = {
  convertMessages: (
    messages: Array<{ role: string; content?: unknown }>,
    system: unknown,
  ) => [
    ...(system ? [{ role: 'system', content: String(system) }] : []),
    ...messages,
  ],
  convertSystemPrompt: (system: unknown) => String(system ?? ''),
  convertTools: () => convertedTools,
  hasGeminiApiHost: () => false,
  isGeminiMode: () => false,
  shouldPreserveGeminiThoughtSignature: () => false,
}

test('keeps store: false by default and removes it only for configured routes', async () => {
  await ensureIntegrationsLoaded()
  const prepare = (model: string, processEnv: NodeJS.ProcessEnv) =>
    prepareOpenAIRequest({
      request: resolveProviderRequest({ model, processEnv }),
      requestProcessEnv: processEnv,
      params: {
        model,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
      },
      dependencies,
    })

  const generic = prepare('gpt-4o', {
    OPENAI_BASE_URL: 'https://gateway.example.test/v1',
    OPENAI_API_KEY: 'test-key',
  })
  expect(generic.body.store).toBe(false)

  const mistral = prepare('codestral-2508', {
    OPENAI_BASE_URL: 'https://api.mistral.ai/v1',
    OPENAI_API_KEY: 'test-key',
  })
  expect(mistral.shimConfig.removeBodyFields).toContain('store')
  expect(mistral.body).not.toHaveProperty('store')
})

test('prepares a chat-completions request without executing transport', async () => {
  await ensureIntegrationsLoaded()
  const processEnv = {
    OPENAI_BASE_URL: 'https://gateway.example.test/v1',
    OPENAI_API_KEY: 'test-key',
  }
  const request = resolveProviderRequest({
    model: 'gpt-4o',
    processEnv,
  })
  const prepared = prepareOpenAIRequest({
    request,
    requestProcessEnv: processEnv,
    params: {
      model: 'gpt-4o',
      system: 'system prompt',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      temperature: 0.2,
      stream: false,
    },
    dependencies,
  })

  expect(prepared.effectiveTransport).toBe('chat_completions')
  expect(prepared.body).toMatchObject({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ],
    max_completion_tokens: 64,
    temperature: 0.2,
    stream: false,
    store: false,
  })
  expect(prepared.body).not.toHaveProperty('stream_options')
})

test('prepares tools and streaming options for a remote chat route', async () => {
  await ensureIntegrationsLoaded()
  const processEnv = {
    OPENAI_BASE_URL: 'https://gateway.example.test/v1',
    OPENAI_API_KEY: 'test-key',
  }
  const request = resolveProviderRequest({ model: 'gpt-4o', processEnv })
  const prepared = prepareOpenAIRequest({
    request,
    requestProcessEnv: processEnv,
    params: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        name: 'Read',
        description: 'Read a file',
        input_schema: { type: 'object', properties: {} },
      }],
      tool_choice: { type: 'tool', name: 'Read' },
      max_tokens: 64,
      stream: true,
    },
    dependencies,
  })

  expect(prepared.body.stream_options).toEqual({ include_usage: true })
  expect(prepared.body.tools).toEqual(convertedTools)
  expect(prepared.body.tool_choice).toEqual({
    type: 'function',
    function: { name: 'Read' },
  })
})
