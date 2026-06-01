/**
 * Unit tests for parseTextToolCalls — the Ollama text-based tool call
 * fallback parser introduced in fix/#1053.
 *
 * Covers the four formats requested in the PR review:
 *   1. Bare JSON object  {"name":"X","arguments":{}}
 *   2. Fenced ```json``` block
 *   3. {type:"function",function:{name,arguments}} shape
 *   4. Deduplication by name:args key
 *   5. P1 context guard — bare JSON in explanatory prose is skipped
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createOpenAIShimClient, parseTextToolCalls } from './openaiShim.js'

type FetchType = typeof globalThis.fetch

type OpenAIShimClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
      ) => Promise<unknown> & {
        withResponse: () => Promise<{ data: AsyncIterable<Record<string, unknown>> }>
      }
    }
  }
}

function makeSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function makeChunks(chunks: unknown[]): string[] {
  return [...chunks.map(c => `data: ${JSON.stringify(c)}\n\n`), 'data: [DONE]\n\n']
}

describe('parseTextToolCalls', () => {
  test('parses bare JSON object {"name","arguments"} shape', () => {
    const text = `Let me read that file.\n{"name":"Read","arguments":{"file_path":"/tmp/foo.ts"}}`
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Read')
    expect(calls[0].arguments).toEqual({ file_path: '/tmp/foo.ts' })
    expect(calls[0].id).toMatch(/^ollama_tc_\d+$/)
  })

  test('parses fenced ```json``` block', () => {
    const text = 'I will run this:\n```json\n{"name":"Bash","arguments":{"command":"ls -la"}}\n```'
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].arguments).toEqual({ command: 'ls -la' })
  })

  test('parses fenced ``` block (no language tag)', () => {
    const text = '```\n{"name":"Glob","arguments":{"pattern":"src/**/*.ts"}}\n```'
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Glob')
  })

  test('parses {type:"function",function:{name,arguments}} shape', () => {
    const text = '{"type":"function","function":{"name":"Grep","arguments":{"pattern":"TODO","path":"src"}}}'
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Grep')
    expect(calls[0].arguments).toEqual({ pattern: 'TODO', path: 'src' })
  })

  test('parses {type:"function"} shape when arguments is a JSON string', () => {
    const args = JSON.stringify({ file_path: '/tmp/x.ts' })
    const text = `{"type":"function","function":{"name":"Read","arguments":${JSON.stringify(args)}}}`
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Read')
    expect(calls[0].arguments).toEqual({ file_path: '/tmp/x.ts' })
  })

  test('deduplicates by name:args key', () => {
    const snippet = '{"name":"Read","arguments":{"file_path":"/tmp/foo.ts"}}'
    const text = `${snippet}\nSome text\n${snippet}`
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
  })

  test('returns multiple distinct calls', () => {
    const text = [
      '{"name":"Read","arguments":{"file_path":"a.ts"}}',
      '{"name":"Bash","arguments":{"command":"echo hi"}}',
    ].join('\n')
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(2)
    expect(calls.map(c => c.name)).toEqual(['Read', 'Bash'])
  })

  test('returns empty array for plain text with no JSON', () => {
    const { calls } = parseTextToolCalls('I think you should check the file manually.')
    expect(calls).toHaveLength(0)
  })

  test('ignores malformed JSON', () => {
    const { calls } = parseTextToolCalls('{"name":"Read","arguments":{broken}')
    expect(calls).toHaveLength(0)
  })

  test('ignores JSON objects without name or type:function', () => {
    const { calls } = parseTextToolCalls('{"foo":"bar","baz":42}')
    expect(calls).toHaveLength(0)
  })

  // P1 context guard — bare JSON followed by explanatory prose must not be extracted
  test('skips bare JSON immediately followed by explanatory text (P1 guard)', () => {
    const text =
      'Here is an example call: {"name":"Bash","arguments":{"command":"ls"}}. Note that you must use this format.'
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(0)
  })

  // P1 context guard — fenced block followed by explanatory prose must also be skipped
  test('skips fenced JSON block immediately followed by explanatory text (P1 guard fenced)', () => {
    const text =
      'Here is the format to use:\n```json\n{"name":"Bash","arguments":{"command":"echo example"}}\n```\nDo not execute it yet.'
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(0)
  })

  test('still parses fenced JSON block with nothing after the closing fence', () => {
    const text = 'Running the command:\n```json\n{"name":"Bash","arguments":{"command":"ls"}}\n```'
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
  })

  test('still parses bare JSON with only trailing whitespace (no trailing context)', () => {
    const text = 'Running the command:\n{"name":"Bash","arguments":{"command":"ls"}}\n'
    const { calls } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
  })

  // toolCallRanges covers the extracted JSON so callers can strip it from text
  test('returns toolCallRanges covering extracted bare JSON', () => {
    const call = '{"name":"Bash","arguments":{"command":"ls"}}'
    const prefix = 'Running:\n'
    const text = prefix + call
    const { calls, toolCallRanges } = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(toolCallRanges).toHaveLength(1)
    const [start, end] = toolCallRanges[0]
    expect(text.slice(start, end)).toBe(call)
  })
})

// ---------------------------------------------------------------------------
// Streaming integration tests — require the full shim pipeline
// ---------------------------------------------------------------------------

const ollamaChunk = (content: string, finishReason?: string) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  model: 'qwen2.5:7b',
  choices: [{ index: 0, delta: { content }, finish_reason: finishReason ?? null }],
})

const ollamaToolChunk = (toolCalls: unknown[], finishReason?: string) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  model: 'qwen2.5:7b',
  choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: finishReason ?? null }],
})

describe('Ollama streaming — think-tag filtering on text-tool fallback (P1)', () => {
  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  })
  afterEach(() => {
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  test('<think> content is NOT emitted as assistant text when text-tool fallback fires', async () => {
    // Repro: model emits <think>private plan</think> followed by tool-call JSON.
    // accumulatedText is raw; stripRanges leaves the <think> block unless we filter it.
    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          ollamaChunk('<think>private plan</think>{"name":"Bash","arguments":{"command":"ls"}}'),
          ollamaChunk('', 'stop'),
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'run ls' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const textDeltas = events.filter(
      e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta',
    )
    for (const d of textDeltas) {
      expect((d.delta as Record<string, string>).text).not.toContain('<think>')
    }

    const toolStarts = events.filter(
      e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'tool_use',
    )
    expect(toolStarts).toHaveLength(1)
    expect((toolStarts[0].content_block as Record<string, string>).name).toBe('Bash')
  })
})

describe('Ollama streaming — plain text response with no tool calls', () => {
  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  })
  afterEach(() => {
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  test('plain text in two chunks (content then stop) is emitted as text_delta', async () => {
    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          ollamaChunk('Hello from Ollama.'),
          ollamaChunk('', 'stop'),
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const allText = events
      .filter(e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta')
      .map(e => (e.delta as Record<string, string>).text)
      .join('')

    expect(allText).toBe('Hello from Ollama.')
    expect(events.filter(e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'tool_use')).toHaveLength(0)
    expect(events.some(e => e.type === 'message_stop')).toBe(true)
  })

  test('plain text in single chunk (content + stop) is emitted as text_delta', async () => {
    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([ollamaChunk('Hello from Ollama.', 'stop')]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const allText = events
      .filter(e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta')
      .map(e => (e.delta as Record<string, string>).text)
      .join('')

    expect(allText).toBe('Hello from Ollama.')
  })

  test('multi-chunk plain text (no tool calls) assembles correctly', async () => {
    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          ollamaChunk('Hello '),
          ollamaChunk('from '),
          ollamaChunk('Ollama.'),
          ollamaChunk('', 'stop'),
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const allText = events
      .filter(e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta')
      .map(e => (e.delta as Record<string, string>).text)
      .join('')

    expect(allText).toBe('Hello from Ollama.')
  })
})

describe('Ollama streaming — visible text before real structured tool_calls (P2)', () => {
  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  })
  afterEach(() => {
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  test('visible assistant text is preserved when real delta.tool_calls follow it', async () => {
    // Repro: Ollama endpoint emits visible prose first, then real structured tool_calls.
    // Before fix: ollamaTextBuffer was discarded when the text block closed.
    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          ollamaChunk('Let me check that.'),
          ollamaToolChunk([
            { index: 0, id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } },
          ]),
          { id: 'chatcmpl-1', object: 'chat.completion.chunk', model: 'qwen2.5:7b',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'run ls' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const allText = events
      .filter(e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta')
      .map(e => (e.delta as Record<string, string>).text)
      .join('')
    expect(allText).toContain('Let me check that.')

    const toolStarts = events.filter(
      e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'tool_use',
    )
    expect(toolStarts).toHaveLength(1)
    expect((toolStarts[0].content_block as Record<string, string>).name).toBe('Bash')
  })
})

describe('Ollama streaming — visible prose before text-based tool-call fallback (P2 buffered path)', () => {
  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  })
  afterEach(() => {
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  test('visible prose before text-based JSON tool call is preserved in emitted text_delta', async () => {
    // Repro: Ollama model emits prose then tool-call JSON as plain text (no delta.tool_calls).
    // Before fix: hasEmittedContentStart === false in the fallback branch, so the prose in
    // ollamaTextBuffer was discarded — only the synthetic tool_use block was emitted.
    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          ollamaChunk('I will inspect the file.\n'),
          ollamaChunk('{"name":"Read","arguments":{"file_path":"/tmp/foo.ts"}}'),
          ollamaChunk('', 'stop'),
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'read the file' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const allText = events
      .filter(e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta')
      .map(e => (e.delta as Record<string, string>).text)
      .join('')
    expect(allText).toContain('I will inspect the file.')

    const toolStarts = events.filter(
      e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'tool_use',
    )
    expect(toolStarts).toHaveLength(1)
    expect((toolStarts[0].content_block as Record<string, string>).name).toBe('Read')
  })
})
