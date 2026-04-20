import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  codexStreamToAnthropic,
  convertAnthropicMessagesToResponsesInput,
  convertCodexResponseToAnthropicMessage,
  convertToolsToResponsesTools,
} from './codexShim.js'

const tempDirs: string[] = []
const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

afterEach(() => {
  if (originalEnv.OPENAI_BASE_URL === undefined) delete process.env.OPENAI_BASE_URL
  else process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL

  if (originalEnv.OPENAI_API_BASE === undefined) delete process.env.OPENAI_API_BASE
  else process.env.OPENAI_API_BASE = originalEnv.OPENAI_API_BASE

  if (originalEnv.CLAUDE_CODE_USE_GITHUB === undefined) delete process.env.CLAUDE_CODE_USE_GITHUB
  else process.env.CLAUDE_CODE_USE_GITHUB = originalEnv.CLAUDE_CODE_USE_GITHUB

  if (originalEnv.OPENAI_MODEL === undefined) delete process.env.OPENAI_MODEL
  else process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempAuthJson(payload: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'openclaude-codex-'))
  tempDirs.push(dir)
  const authPath = join(dir, 'auth.json')
  writeFileSync(authPath, JSON.stringify(payload), 'utf8')
  return authPath
}

async function collectStreamEventTypes(responseText: string): Promise<string[]> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(responseText))
      controller.close()
    },
  })

  const events: string[] = []
  for await (const event of codexStreamToAnthropic(new Response(stream), 'gpt-5.4')) {
    events.push(event.type)
  }
  return events
}

async function importFreshProviderConfigModule() {
  return import(`./providerConfig.js?ts=${Date.now()}-${Math.random()}`)
}

describe('Codex provider config', () => {
  const originalOpenaiBaseUrl = process.env.OPENAI_BASE_URL
  const originalOpenaiApiBase = process.env.OPENAI_API_BASE

  beforeEach(() => {
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
  })

  afterEach(() => {
    if (originalOpenaiBaseUrl === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = originalOpenaiBaseUrl
    if (originalOpenaiApiBase === undefined) delete process.env.OPENAI_API_BASE
    else process.env.OPENAI_API_BASE = originalOpenaiApiBase
  })

  test('resolves codexplan alias to Codex transport with reasoning', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.CLAUDE_CODE_USE_GITHUB

    const resolved = resolveProviderRequest({ model: 'codexplan' })
    expect(resolved.transport).toBe('codex_responses')
    expect(resolved.resolvedModel).toBe('gpt-5.4')
    expect(resolved.reasoning).toEqual({ effort: 'high' })
    expect(resolved.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
  })

  test('resolves codexspark alias to Codex transport with Codex base URL', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.CLAUDE_CODE_USE_GITHUB

    const resolved = resolveProviderRequest({ model: 'codexspark' })
    expect(resolved.transport).toBe('codex_responses')
    expect(resolved.resolvedModel).toBe('gpt-5.3-codex-spark')
    expect(resolved.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
  })

  test('does not force Codex transport when a local non-Codex base URL is explicit', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    const resolved = resolveProviderRequest({
      model: 'codexplan',
      baseUrl: 'http://127.0.0.1:8080/v1',
    })

    expect(resolved.transport).toBe('chat_completions')
    expect(resolved.baseUrl).toBe('http://127.0.0.1:8080/v1')
    expect(resolved.resolvedModel).toBe('gpt-5.4')
  })

  test('resolves codexplan to Codex transport even when OPENAI_BASE_URL is the string "undefined"', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    // On Windows, env vars can leak as the literal string "undefined" instead of
    // the JS value undefined when not properly unset (issue #336).
    process.env.OPENAI_BASE_URL = 'undefined'
    const resolved = resolveProviderRequest({ model: 'codexplan' })
    expect(resolved.transport).toBe('codex_responses')
  })

  test('resolves codexplan to Codex transport even when OPENAI_BASE_URL is an empty string', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    process.env.OPENAI_BASE_URL = ''
    const resolved = resolveProviderRequest({ model: 'codexplan' })
    expect(resolved.transport).toBe('codex_responses')
  })

  test('prefers explicit baseUrl option over env var', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    process.env.OPENAI_BASE_URL = 'https://example.com/v1'
    const resolved = resolveProviderRequest({ model: 'codexplan', baseUrl: 'https://chatgpt.com/backend-api/codex' })
    expect(resolved.transport).toBe('codex_responses')
    expect(resolved.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
  })

  test('default gpt-4o uses OpenAI base URL (no regression)', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    delete process.env.OPENAI_BASE_URL
    delete process.env.CLAUDE_CODE_USE_GITHUB

    const resolved = resolveProviderRequest({ model: 'gpt-4o' })
    expect(resolved.transport).toBe('chat_completions')
    expect(resolved.baseUrl).toBe('https://api.openai.com/v1')
    expect(resolved.resolvedModel).toBe('gpt-4o')
  })

  test('resolves codexplan from env var OPENAI_MODEL to Codex endpoint', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    process.env.OPENAI_MODEL = 'codexplan'
    delete process.env.OPENAI_BASE_URL
    delete process.env.CLAUDE_CODE_USE_GITHUB

    const resolved = resolveProviderRequest()
    expect(resolved.transport).toBe('codex_responses')
    expect(resolved.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
    expect(resolved.resolvedModel).toBe('gpt-5.4')
  })

  test('does not override custom base URL for codexplan (e.g., local provider)', async () => {
    const { resolveProviderRequest } = await importFreshProviderConfigModule()
    process.env.OPENAI_MODEL = 'codexplan'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    delete process.env.CLAUDE_CODE_USE_GITHUB

    const resolved = resolveProviderRequest()
    expect(resolved.transport).toBe('chat_completions')
    expect(resolved.baseUrl).toBe('http://localhost:11434/v1')
  })

  test('loads Codex credentials from auth.json fallback', async () => {
    const { resolveCodexApiCredentials } = await importFreshProviderConfigModule()
    const authPath = createTempAuthJson({
      tokens: {
        access_token: 'header.payload.signature',
        account_id: 'acct_test',
      },
    })

    const credentials = resolveCodexApiCredentials({
      CODEX_AUTH_JSON_PATH: authPath,
    } as NodeJS.ProcessEnv)

    expect(credentials.apiKey).toBe('header.payload.signature')
    expect(credentials.accountId).toBe('acct_test')
    expect(credentials.source).toBe('auth.json')
  })

  test('does not treat auth.json id_token as a Codex bearer credential', async () => {
    const { resolveCodexApiCredentials } = await importFreshProviderConfigModule()
    const idTokenPayload = Buffer.from(
      JSON.stringify({
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_from_id_token',
        },
      }),
      'utf8',
    ).toString('base64url')
    const authPath = createTempAuthJson({
      tokens: {
        id_token: `header.${idTokenPayload}.signature`,
      },
    })

    const credentials = resolveCodexApiCredentials({
      CODEX_AUTH_JSON_PATH: authPath,
    } as NodeJS.ProcessEnv)

    expect(credentials.apiKey).toBe('')
    expect(credentials.accountId).toBe('acct_from_id_token')
    expect(credentials.source).toBe('none')
  })
})

describe('Codex request translation', () => {
  test('normalizes optional parameters into strict Responses schemas', () => {
    const tools = convertToolsToResponsesTools([
      {
        name: 'Agent',
        description: 'Spawn a sub-agent',
        input_schema: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            prompt: { type: 'string' },
            subagent_type: { type: 'string' },
          },
          required: ['description', 'prompt'],
          additionalProperties: false,
        },
      },
    ])

    expect(tools).toEqual([
      {
        type: 'function',
        name: 'Agent',
        description: 'Spawn a sub-agent',
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            prompt: { type: 'string' },
            subagent_type: { type: 'string' },
          },
          required: ['description', 'prompt', 'subagent_type'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
  })

  test('keeps strict mode for tools whose schema already matches Responses requirements', () => {
    const tools = convertToolsToResponsesTools([
      {
        name: 'Ping',
        description: 'Ping tool',
        input_schema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
          additionalProperties: false,
        },
      },
    ])

    expect(tools).toEqual([
      {
        type: 'function',
        name: 'Ping',
        description: 'Ping tool',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
  })

  test('preserves Grep tool pattern field in Codex strict schemas', () => {
    const tools = convertToolsToResponsesTools([
      {
        name: 'Grep',
        description: 'Search file contents',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            path: { type: 'string' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ])

    expect(tools).toEqual([
      {
        type: 'function',
        name: 'Grep',
        description: 'Search file contents',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            path: { type: 'string' },
          },
          required: ['pattern', 'path'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
  })

  test('preserves Glob tool pattern field in Codex strict schemas', () => {
    const tools = convertToolsToResponsesTools([
      {
        name: 'Glob',
        description: 'Find files by pattern',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' },
            path: { type: 'string' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ])

    expect(tools).toEqual([
      {
        type: 'function',
        name: 'Glob',
        description: 'Find files by pattern',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' },
            path: { type: 'string' },
          },
          required: ['pattern', 'path'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
  })

  test('strips validator pattern keyword but keeps string field named pattern in Codex schemas', () => {
    const tools = convertToolsToResponsesTools([
      {
        name: 'RegexProbe',
        description: 'Probe regex schema handling',
        input_schema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              pattern: '^[a-z]+$',
            },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ])

    expect(tools).toEqual([
      {
        type: 'function',
        name: 'RegexProbe',
        description: 'Probe regex schema handling',
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
            },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
  })

  test('removes unsupported uri format from strict Responses schemas', () => {
    const tools = convertToolsToResponsesTools([
      {
        name: 'WebFetch',
        description: 'Fetch a URL',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' },
            prompt: { type: 'string' },
          },
          required: ['url', 'prompt'],
          additionalProperties: false,
        },
      },
    ])

    expect(tools).toEqual([
      {
        type: 'function',
        name: 'WebFetch',
        description: 'Fetch a URL',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            prompt: { type: 'string' },
          },
          required: ['url', 'prompt'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
  })

  test('sanitizes malformed enum/default values for Responses tool schemas', () => {
    const tools = convertToolsToResponsesTools([
      {
        name: 'mcp__clientry__create_task',
        description: 'Create a task',
        input_schema: {
          type: 'object',
          properties: {
            priority: {
              type: 'integer',
              description: 'Priority: 0=low, 1=medium, 2=high, 3=urgent',
              default: true,
              enum: [false, 0, 1, 2, 3],
            },
          },
        },
      },
    ])

    expect(tools).toEqual([
      {
        type: 'function',
        name: 'mcp__clientry__create_task',
        description: 'Create a task',
        parameters: {
          type: 'object',
          properties: {
            priority: {
              type: 'integer',
              description: 'Priority: 0=low, 1=medium, 2=high, 3=urgent',
              enum: [0, 1, 2, 3],
            },
          },
          required: ['priority'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
  })

  test('converts assistant tool use and user tool result into Responses items', () => {
    const items = convertAnthropicMessagesToResponsesInput([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Working...' },
          { type: 'tool_use', id: 'call_123', name: 'search', input: { q: 'x' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_123', content: 'done' },
        ],
      },
    ])

    expect(items).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Working...' }],
      },
      {
        type: 'function_call',
        id: 'fc_123',
        call_id: 'call_123',
        name: 'search',
        arguments: '{"q":"x"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_123',
        output: 'done',
      },
    ])
  })

  test('converts completed Codex tool response into Anthropic message', () => {
    const message = convertCodexResponseToAnthropicMessage(
      {
        id: 'resp_1',
        model: 'gpt-5.3-codex-spark',
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'ping',
            arguments: '{"value":"ping"}',
          },
        ],
        usage: { input_tokens: 12, output_tokens: 4 },
      },
      'gpt-5.3-codex-spark',
    )

    expect(message.stop_reason).toBe('tool_use')
    expect(message.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'ping',
        input: { value: 'ping' },
      },
    ])
  })

  test('strips <think> tag block from completed Codex text responses', () => {
    const message = convertCodexResponseToAnthropicMessage(
      {
        id: 'resp_1',
        model: 'gpt-5.4',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text:
                  '<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?',
              },
            ],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 4 },
      },
      'gpt-5.4',
    )

    expect(message.content).toEqual([
      {
        type: 'text',
        text: 'Hey! How can I help you today?',
      },
    ])
  })

  test('strips unterminated <think> tag at block boundary in Codex completed response', () => {
    const message = convertCodexResponseToAnthropicMessage(
      {
        id: 'resp_1',
        model: 'gpt-5.4',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text:
                  'Here is the answer.\n<think>wait, let me reconsider the user request',
              },
            ],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 4 },
      },
      'gpt-5.4',
    )

    expect(message.content).toEqual([
      {
        type: 'text',
        text: 'Here is the answer.',
      },
    ])
  })

  test('translates Codex SSE text stream into Anthropic events', async () => {
    const responseText = [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","content":[],"role":"assistant"},"output_index":0,"sequence_number":0}',
      '',
      'event: response.content_part.added',
      'data: {"type":"response.content_part.added","content_index":0,"item_id":"msg_1","output_index":0,"part":{"type":"output_text","text":""},"sequence_number":1}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","content_index":0,"delta":"ok","item_id":"msg_1","output_index":0,"sequence_number":2}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","status":"completed","content":[{"type":"output_text","text":"ok"}],"role":"assistant"},"output_index":0,"sequence_number":3}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.4","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":2,"output_tokens":1}},"sequence_number":4}',
      '',
    ].join('\n')

    const eventTypes = await collectStreamEventTypes(responseText)

    expect(eventTypes).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
  })

  test('strips <think> tag block from Codex SSE text stream', async () => {
    const responseText = [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","content":[],"role":"assistant"},"output_index":0,"sequence_number":0}',
      '',
      'event: response.content_part.added',
      'data: {"type":"response.content_part.added","content_index":0,"item_id":"msg_1","output_index":0,"part":{"type":"output_text","text":""},"sequence_number":1}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","content_index":0,"delta":"<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?","item_id":"msg_1","output_index":0,"sequence_number":2}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","status":"completed","content":[{"type":"output_text","text":"<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?"}],"role":"assistant"},"output_index":0,"sequence_number":3}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.4","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"<think>user wants a greeting, respond briefly</think>Hey! How can I help you today?"}]}],"usage":{"input_tokens":2,"output_tokens":1}},"sequence_number":4}',
      '',
    ].join('\n')

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(responseText))
        controller.close()
      },
    })

    const textDeltas: string[] = []
    for await (const event of codexStreamToAnthropic(
      new Response(stream),
      'gpt-5.4',
    )) {
      const delta = (event as { delta?: { type?: string; text?: string } }).delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        textDeltas.push(delta.text)
      }
    }

    expect(textDeltas.join('')).toBe('Hey! How can I help you today?')
  })

  test('preserves prose without tags (no phrase-based false positive)', async () => {
    // Regression test: older phrase-based sanitizer would incorrectly strip text
    // starting with "I should" or "The user". The tag-based approach leaves it alone.
    const responseText = [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","content":[],"role":"assistant"},"output_index":0,"sequence_number":0}',
      '',
      'event: response.content_part.added',
      'data: {"type":"response.content_part.added","content_index":0,"item_id":"msg_1","output_index":0,"part":{"type":"output_text","text":""},"sequence_number":1}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","content_index":0,"delta":"I should note that the user role requires a briefly concise friendly response format.","item_id":"msg_1","output_index":0,"sequence_number":2}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","status":"completed","content":[{"type":"output_text","text":"I should note that the user role requires a briefly concise friendly response format."}],"role":"assistant"},"output_index":0,"sequence_number":3}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.4","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I should note that the user role requires a briefly concise friendly response format."}]}],"usage":{"input_tokens":2,"output_tokens":1}},"sequence_number":4}',
      '',
    ].join('\n')

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(responseText))
        controller.close()
      },
    })

    const textDeltas: string[] = []
    for await (const event of codexStreamToAnthropic(
      new Response(stream),
      'gpt-5.4',
    )) {
      const delta = (event as { delta?: { type?: string; text?: string } }).delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        textDeltas.push(delta.text)
      }
    }

    expect(textDeltas.join('')).toBe(
      'I should note that the user role requires a briefly concise friendly response format.',
    )
  })
})
