import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  codexStreamToAnthropic,
  convertAnthropicMessagesToResponsesInput,
  convertCodexResponseToAnthropicMessage,
  convertToolsToResponsesTools,
} from './codexShim.js'
import {
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from './providerConfig.js'

const tempDirs: string[] = []

afterEach(() => {
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

async function collectStreamEvents(
  responseText: string,
): Promise<AnthropicStreamEvent[]> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(responseText))
      controller.close()
    },
  })

  const events: AnthropicStreamEvent[] = []
  for await (const event of codexStreamToAnthropic(new Response(stream), 'gpt-5.4')) {
    events.push(event)
  }
  return events
}

describe('Codex provider config', () => {
  test('resolves codexplan alias to Codex transport with reasoning', () => {
    const resolved = resolveProviderRequest({ model: 'codexplan' })
    expect(resolved.transport).toBe('codex_responses')
    expect(resolved.resolvedModel).toBe('gpt-5.4')
    expect(resolved.reasoning).toEqual({ effort: 'high' })
  })

  test('loads Codex credentials from auth.json fallback', () => {
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

  test('flushes final function-call arguments from output_item.done', async () => {
    const responseText = [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","status":"in_progress","call_id":"call_1","name":"Bash","arguments":""},"output_index":0,"sequence_number":0}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"id":"fc_1","type":"function_call","status":"completed","call_id":"call_1","name":"Bash","arguments":"{\\"command\\":\\"ls -la\\"}"},"output_index":0,"sequence_number":1}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.4","output":[{"type":"function_call","call_id":"call_1","name":"Bash","arguments":"{\\"command\\":\\"ls -la\\"}"}],"usage":{"input_tokens":2,"output_tokens":1}},"sequence_number":2}',
      '',
    ].join('\n')

    const events = await collectStreamEvents(responseText)
    const partialJson = events
      .filter(
        event =>
          event.type === 'content_block_delta' &&
          event.delta?.type === 'input_json_delta',
      )
      .map(event => event.delta?.partial_json)

    expect(partialJson).toEqual(['{"command":"ls -la"}'])
  })
})
