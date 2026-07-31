import { expect, test } from 'bun:test'
import { ensureIntegrationsLoaded } from '../../../integrations/index.js'
import { resolveProviderRequest } from '../providerConfig.js'
import { prepareOpenAIRequest } from './requestPreparation.js'

const dependencies = {
  convertMessages: (
    messages: Array<{ role: string; content?: unknown }>,
    system: unknown,
  ) => [
    ...(system ? [{ role: 'system', content: String(system) }] : []),
    ...messages,
  ],
  convertSystemPrompt: (system: unknown) => String(system ?? ''),
  convertTools: (tools: unknown[]) => tools,
  hasGeminiApiHost: () => false,
  isGeminiMode: () => false,
  shouldPreserveGeminiThoughtSignature: () => false,
}

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
  expect(prepared.body.tools).toHaveLength(1)
  expect(prepared.body.tool_choice).toEqual({
    type: 'function',
    function: { name: 'Read' },
  })
})
