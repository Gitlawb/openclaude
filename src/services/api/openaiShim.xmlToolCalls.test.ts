/**
 * Unit + integration tests for the XML tool-call fallback.
 *
 * Models in the GLM / Qwen / DeepSeek family routed through OpenAI-compatible
 * gateways frequently emit tool calls as XML text inside the assistant message
 * instead of as structured `tool_calls`. Without recovery these leak into
 * visible prose and never execute, so the turn ends with no tool_use block and
 * the agent appears to "forget" and stop mid-task (the reported bug).
 *
 * Covers the three dialects seen in the wild plus the streaming/non-streaming
 * pipeline integration:
 *   A. <tool_call><function=NAME><parameter=KEY>VALUE</parameter>…</function></tool_call>
 *   B. <tool_call>NAME<arg_key>KEY</arg_key><arg_value>VALUE</arg_value>…</tool_call>
 *   C. <tool_call>{"name":"NAME","arguments":{…}}</tool_call>
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createOpenAIShimClient, parseXmlToolCalls } from './openaiShim.js'

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

const glmChunk = (content: string, finishReason?: string) => ({
  id: 'chatcmpl-glm',
  object: 'chat.completion.chunk',
  model: 'glm-5.2',
  choices: [{ index: 0, delta: { content }, finish_reason: finishReason ?? null }],
})

const glmToolChunk = (toolCalls: unknown[], finishReason?: string) => ({
  id: 'chatcmpl-glm',
  object: 'chat.completion.chunk',
  model: 'glm-5.2',
  choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: finishReason ?? null }],
})

// ---------------------------------------------------------------------------
// Parser unit tests
// ---------------------------------------------------------------------------

describe('parseXmlToolCalls', () => {
  test('dialect A: <function=NAME><parameter=KEY>VALUE</parameter>', () => {
    const text =
      '<tool_call><function=Read>\n<parameter=file_path>/tmp/foo.ts</parameter>\n</function></tool_call>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Read')
    expect(calls[0].arguments).toEqual({ file_path: '/tmp/foo.ts' })
    expect(calls[0].id).toMatch(/^xml_tc_\d+$/)
  })

  test('dialect A: coerces numeric/boolean parameter values, keeps strings', () => {
    const text =
      '<tool_call><function=Grep>' +
      '<parameter=pattern>TODO</parameter>' +
      '<parameter=limit>10</parameter>' +
      '<parameter=multiline>true</parameter>' +
      '</function></tool_call>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls[0].arguments).toEqual({ pattern: 'TODO', limit: 10, multiline: true })
  })

  test('dialect A: nested JSON object parameter round-trips', () => {
    const text =
      '<tool_call><function=Edit>' +
      '<parameter=edits>[{"old":"a","new":"b"}]</parameter>' +
      '</function></tool_call>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls[0].arguments).toEqual({ edits: [{ old: 'a', new: 'b' }] })
  })

  test('dialect B: GLM-native <arg_key>/<arg_value>', () => {
    const text =
      '<tool_call>Bash\n<arg_key>command</arg_key>\n<arg_value>ls -la</arg_value>\n</tool_call>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].arguments).toEqual({ command: 'ls -la' })
  })

  test('dialect C: Hermes JSON inside <tool_call>', () => {
    const text =
      '<tool_call>{"name":"Glob","arguments":{"pattern":"src/**/*.ts"}}</tool_call>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Glob')
    expect(calls[0].arguments).toEqual({ pattern: 'src/**/*.ts' })
  })

  test('dialect C: arguments as a JSON string is parsed', () => {
    const text =
      '<tool_call>{"name":"Bash","arguments":"{\\"command\\":\\"pwd\\"}"}</tool_call>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].arguments).toEqual({ command: 'pwd' })
  })

  test('multiple tool calls in one message', () => {
    const text =
      '<tool_call><function=Read><parameter=file_path>a.ts</parameter></function></tool_call>' +
      'some prose between\n' +
      '<tool_call><function=Read><parameter=file_path>b.ts</parameter></function></tool_call>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls.map(c => c.arguments)).toEqual([{ file_path: 'a.ts' }, { file_path: 'b.ts' }])
  })

  test('prose before/after tool call is reported via ranges (not consumed)', () => {
    const text =
      "I'll read it.\n<tool_call><function=Read><parameter=file_path>x.ts</parameter></function></tool_call>\nDone."
    const { calls, toolCallRanges } = parseXmlToolCalls(text)
    expect(calls).toHaveLength(1)
    const stripped =
      text.slice(0, toolCallRanges[0][0]) + text.slice(toolCallRanges[0][1])
    expect(stripped).toBe("I'll read it.\n\nDone.")
  })

  test('deduplicates identical calls', () => {
    const block = '<tool_call><function=Read><parameter=file_path>a.ts</parameter></function></tool_call>'
    const { calls } = parseXmlToolCalls(block + '\n' + block)
    expect(calls).toHaveLength(1)
  })

  test('truncated block (no closing tag) still parses', () => {
    const text = '<tool_call><function=Bash><parameter=command>ls</parameter></function>'
    const { calls } = parseXmlToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
  })

  test('no <tool_call> markers → no calls (plain prose is safe)', () => {
    const { calls, toolCallRanges } = parseXmlToolCalls(
      'Here is how a <function=Foo> tag would look in documentation.',
    )
    expect(calls).toHaveLength(0)
    expect(toolCallRanges).toHaveLength(0)
  })

  test('<tool_call> with no recognizable call → no calls emitted', () => {
    const { calls } = parseXmlToolCalls('<tool_call>garbage with no function</tool_call>')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Streaming integration (non-Ollama OpenAI-compatible gateway, e.g. GLM-5.2)
// ---------------------------------------------------------------------------

describe('GLM streaming — XML tool calls', () => {
  let originalFetch: FetchType
  beforeEach(() => {
    originalFetch = globalThis.fetch
    process.env.OPENAI_API_KEY = 'test-key'
    // Deliberately NOT an Ollama endpoint, so isOllama=false.
    process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  async function run(chunks: unknown[]): Promise<Record<string, unknown>[]> {
    globalThis.fetch = (async () =>
      makeSseResponse(makeChunks(chunks))) as unknown as FetchType
    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'glm-5.2',
        messages: [{ role: 'user', content: 'do it' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()
    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)
    return events
  }

  const textOf = (events: Record<string, unknown>[]) =>
    events
      .filter(e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta')
      .map(e => (e.delta as Record<string, string>).text)
      .join('')

  const toolStarts = (events: Record<string, unknown>[]) =>
    events.filter(
      e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'tool_use',
    )

  test('emits tool_use and hides raw XML (single chunk)', async () => {
    const events = await run([
      glmChunk('<tool_call><function=Bash><parameter=command>ls -la</parameter></function></tool_call>'),
      glmChunk('', 'stop'),
    ])
    const starts = toolStarts(events)
    expect(starts).toHaveLength(1)
    expect((starts[0].content_block as Record<string, string>).name).toBe('Bash')
    expect(textOf(events)).not.toContain('<tool_call>')
    expect(textOf(events)).not.toContain('<function=')
    const stop = events.find(e => e.type === 'message_delta')
    expect((stop?.delta as Record<string, string>)?.stop_reason).toBe('tool_use')
  })

  test('opener split across SSE deltas is still recovered', async () => {
    const events = await run([
      glmChunk('<tool_'),
      glmChunk('call><function=Bash><parameter=command>pwd</parameter></function></tool_call>'),
      glmChunk('', 'stop'),
    ])
    const starts = toolStarts(events)
    expect(starts).toHaveLength(1)
    expect((starts[0].content_block as Record<string, string>).name).toBe('Bash')
    expect(textOf(events)).not.toContain('<tool_')
  })

  test('prose before the tool call is preserved, XML stripped', async () => {
    const events = await run([
      glmChunk("I'll list the directory.\n"),
      glmChunk('<tool_call><function=Bash><parameter=command>ls</parameter></function></tool_call>'),
      glmChunk('', 'stop'),
    ])
    expect(toolStarts(events)).toHaveLength(1)
    // Prose streams verbatim (trailing newline preserved); only the XML is stripped.
    expect(textOf(events).trim()).toBe("I'll list the directory.")
    expect(textOf(events)).not.toContain('<tool_call>')
  })

  test('input_json_delta carries the parsed arguments', async () => {
    const events = await run([
      glmChunk('<tool_call><function=Read><parameter=file_path>/tmp/x.ts</parameter></function></tool_call>'),
      glmChunk('', 'stop'),
    ])
    const jsonDelta = events.find(
      e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'input_json_delta',
    )
    expect(JSON.parse((jsonDelta!.delta as Record<string, string>).partial_json)).toEqual({
      file_path: '/tmp/x.ts',
    })
  })

  test('false positive: prose mentioning <tool_call> with no valid call is emitted as text', async () => {
    const events = await run([
      glmChunk('The <tool_call> tag is how models request tools.'),
      glmChunk('', 'stop'),
    ])
    expect(toolStarts(events)).toHaveLength(0)
    expect(textOf(events)).toBe('The <tool_call> tag is how models request tools.')
  })

  // Locks in current behavior: when a single streamed message contains prose
  // *between* two XML tool calls, all surviving prose is emitted in one text
  // block BEFORE the tool_use blocks (the interleave is flattened to
  // prose-then-all-calls). This mirrors the Ollama text fallback and is fine
  // for agent loops, which act on the tool calls regardless of prose order.
  test('multiple tool calls with interleaved prose: prose flattened before calls', async () => {
    const events = await run([
      glmChunk("I'll do two things.\n"),
      glmChunk(
        '<tool_call><function=Read><parameter=file_path>a.ts</parameter></function></tool_call>' +
          'middle prose' +
          '<tool_call><function=Read><parameter=file_path>b.ts</parameter></function></tool_call>',
      ),
      glmChunk('', 'stop'),
    ])
    const starts = toolStarts(events)
    expect(starts.map(s => (s.content_block as Record<string, string>).name)).toEqual(['Read', 'Read'])
    // Both prose fragments survive (leading prose + between-call prose), with the
    // raw XML stripped; calls follow the prose.
    expect(textOf(events)).toBe("I'll do two things.\nmiddle prose")
    expect(textOf(events)).not.toContain('<tool_call>')
    // All text deltas precede the first tool_use start (prose-then-calls order).
    const firstToolIdx = events.findIndex(
      e => e.type === 'content_block_start' && (e.content_block as Record<string, string>)?.type === 'tool_use',
    )
    const lastTextIdx = events.map(e => e.type === 'content_block_delta' && (e.delta as Record<string, string>)?.type === 'text_delta').lastIndexOf(true)
    expect(lastTextIdx).toBeLessThan(firstToolIdx)
  })

  test('structured tool_calls still work and do not trip the XML path', async () => {
    const events = await run([
      glmToolChunk([{ index: 0, id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } }]),
      glmToolChunk([{ index: 0, function: { arguments: '' } }], 'tool_calls'),
    ])
    const starts = toolStarts(events)
    expect(starts).toHaveLength(1)
    expect((starts[0].content_block as Record<string, string>).name).toBe('Bash')
  })
})
