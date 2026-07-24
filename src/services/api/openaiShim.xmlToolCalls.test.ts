/**
 * Unit + integration tests for the XML tool-call fallback.
 *
 * Models in the GLM / Qwen / DeepSeek family routed through OpenAI-compatible
 * gateways frequently emit tool calls as XML text inside the assistant message
 * instead of as structured `tool_calls`. Without recovery these leak into
 * visible prose and never execute, so the turn ends with no tool_use block and
 * the agent appears to "forget" and stop mid-task (the reported bug).
 *
 * Covers the four dialects seen in the wild plus the streaming/non-streaming
 * pipeline integration:
 *   A. <tool_call><function=NAME><parameter=KEY>VALUE</parameter>…</function></tool_call>
 *   B. <tool_call>NAME<arg_key>KEY</arg_key><arg_value>VALUE</arg_value>…</tool_call>
 *   C. <tool_call>{"name":"NAME","arguments":{…}}</tool_call>
 *   D. <tool_calls:ID><tool_call:ID>NAME<parameter name="KEY">VALUE</parameter>…</tool_calls:ID>
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

/** Local mirror of stripRanges for unit assertions (not exported from shim). */
function stripRangesForTest(
  text: string,
  ranges: Array<[number, number]>,
): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  let result = ''
  let pos = 0
  for (const [s, e] of sorted) {
    result += text.slice(pos, s)
    pos = e
  }
  return result + text.slice(pos)
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

const hy3Chunk = (content: string, finishReason?: string) => ({
  id: 'chatcmpl-hy3',
  object: 'chat.completion.chunk',
  model: 'tencent/hy3',
  choices: [{ index: 0, delta: { content }, finish_reason: finishReason ?? null }],
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

  test('dialect D: Tencent HY3 wrapper with named parameters', () => {
    const text =
      '<tool_calls:call_1><tool_call:call_1>TaskCreate\n' +
      '<parameter name="subject">Verify HY3</parameter>' +
      '<parameter name="description">Run the live test</parameter>' +
      '</invoke></tool_call:call_1></tool_calls:call_1>'
    const { calls, toolCallRanges } = parseXmlToolCalls(text, true)

    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('TaskCreate')
    expect(calls[0].arguments).toEqual({
      subject: 'Verify HY3',
      description: 'Run the live test',
    })
    expect(toolCallRanges).toEqual([[0, text.length]])
  })

  test('dialect D: Tencent HY3 inline named arguments', () => {
    const text =
      '<tool_call:call_1>TaskCreate\n' +
      ' subject: Verify HY3\n' +
      ' description: Run the live test\n' +
      ' activeForm: Validating HY3\n' +
      '</tool_call:call_1>'
    const { calls } = parseXmlToolCalls(text, true)

    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('TaskCreate')
    expect(calls[0].arguments).toEqual({
      subject: 'Verify HY3',
      description: 'Run the live test',
      activeForm: 'Validating HY3',
    })
  })

  test('does not treat a literal HY3 wrapper example as a tool call', () => {
    const text =
      'Documentation: <tool_call:example>Run this example</tool_call:example>'
    const { calls, toolCallRanges } = parseXmlToolCalls(text, true)

    expect(calls).toEqual([])
    expect(toolCallRanges).toEqual([])
  })

  test('does not recover structured HY3 examples for non-HY3 routes', () => {
    const text =
      '<tool_call:example>TaskCreate\nsubject: merely a documentation example\n</tool_call:example>'
    const { calls, toolCallRanges } = parseXmlToolCalls(text)

    expect(calls).toEqual([])
    expect(toolCallRanges).toEqual([])
  })

  test('allows zero-argument tools without a name allowlist', () => {
    const { calls } = parseXmlToolCalls(
      '<tool_call:call_1>CronList</tool_call:call_1>',
      true,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ name: 'CronList', arguments: {} })
  })

  test('dialect D: Tencent HY3 official tagged arguments', () => {
    const text =
      '<tool_calls:opensource><tool_call:opensource>TaskCreate<tool_sep:opensource>' +
      '<arg_key:opensource>subject</arg_key:opensource><arg_value:opensource>Verify HY3</arg_value:opensource>' +
      '<arg_key:opensource>description</arg_key:opensource><arg_value:opensource>Run the live test</arg_value:opensource>' +
      '</tool_call:opensource></tool_calls:opensource>'
    const { calls, toolCallRanges } = parseXmlToolCalls(text, true)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      name: 'TaskCreate',
      arguments: { subject: 'Verify HY3', description: 'Run the live test' },
    })
    expect(toolCallRanges).toEqual([[0, text.length]])
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

  test('stripToolCallRanges covers every duplicate XML block (1:1 toolCallRanges stays unique)', () => {
    // Regression: dedup must not leave a second identical <tool_call> visible.
    const block =
      '<tool_call><function=Bash><parameter=command>pwd</parameter></function></tool_call>'
    const text = `${block}\n${block}\nnext`
    const { calls, toolCallRanges, stripToolCallRanges, stripRangeOwnerIndex } = parseXmlToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(toolCallRanges).toHaveLength(1)
    expect(stripToolCallRanges).toHaveLength(2)
    expect(stripRangeOwnerIndex).toHaveLength(2)
    // Both strip ranges belong to the same unique call (index 0).
    expect(stripRangeOwnerIndex).toEqual([0, 0])
    const stripped = stripRangesForTest(text, stripToolCallRanges)
    expect(stripped).not.toContain('<tool_call>')
    expect(stripped).toContain('next')
  })

  // Integration test for duplicate XML block stripping with allowlist filtering.
  // Tests the full production path: streaming through createOpenAIShimClient with
  // tools parameter and verify both duplicate blocks are stripped from text.
  test('streaming: duplicate accepted XML blocks stripped from text, tool_use deduped', async () => {
    // Mock endpoint that echoes back our streaming response with duplicate XML calls.
    const duplicateBlock =
      '<tool_call><function=Bash><parameter=command>echo hello</parameter></function></tool_call>'
    const responseText = `${duplicateBlock}\n${duplicateBlock}\nnext`

    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9999/v1'
    process.env.OPENAI_API_KEY = 'test-key'

    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        [
          `data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 123456789,
            model: 'test-model',
            choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }],
          })}\n\n`,
          `data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 123456789,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`,
          'data: [DONE]\n\n',
        ].join(''),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Transfer-Encoding': 'chunked',
          },
        },
      )
    }) as unknown as typeof fetch

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result: AnthropicStreamEvent[] = []

    const stream = await client.beta.messages.create({
      model: 'test-model',
      tools: [{ type: 'function' as const, function: { name: 'Bash', parameters: {} } }],
      messages: [
        { role: 'assistant' as const, content: 'Testing duplicates' },
        { role: 'user' as const, content: 'Run bash' },
      ],
      max_tokens: 1024,
      stream: true,
    } as any)

    for await (const event of stream) {
      result.push(event)
    }

    // Verify we got one tool_use event (duplicates are deduped at call level).
    const toolUseEvents = result.filter(e => e.type === 'content_block_start' && (e.content_block?.type === 'tool_use'))
    expect(toolUseEvents).toHaveLength(1)
    expect(toolUseEvents[0]?.content_block?.name).toBe('Bash')

    // Find the text_delta event and verify both XML blocks are stripped, "next" preserved.
    const textEvents = result.filter(e => e.type === 'content_block_delta' && (e as any).delta?.type === 'text_delta')
    const fullText = textEvents.map(e => (e as any).delta.text).join('')
    expect(fullText).toContain('next')
    expect(fullText).not.toContain('<tool_call>')
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

  async function run(
    chunks: unknown[],
    model = 'glm-5.2',
  ): Promise<Record<string, unknown>[]> {
    const previousFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      makeSseResponse(makeChunks(chunks))) as unknown as FetchType
    try {
      const client = createOpenAIShimClient({}) as OpenAIShimClient
      const result = await client.beta.messages
        .create({
          model,
          messages: [{ role: 'user', content: 'do it' }],
          max_tokens: 64,
          stream: true,
        })
        .withResponse()
      const events: Record<string, unknown>[] = []
      for await (const event of result.data) events.push(event)
      return events
    } finally {
      globalThis.fetch = previousFetch
    }
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

  test('does not recover a structured HY3 example for a non-HY3 model', async () => {
    const text =
      '<tool_call:example>TaskCreate\nsubject: merely a documentation example\n</tool_call:example>'
    const events = await run([glmChunk(text), glmChunk('', 'stop')])

    expect(toolStarts(events)).toHaveLength(0)
    expect(textOf(events)).toBe(text)
  })

  test('does not recover a structured HY3 example for a non-Tencent model name', async () => {
    const text =
      '<tool_call:example>TaskCreate\nsubject: merely a documentation example\n</tool_call:example>'
    const events = await run(
      [glmChunk(text), glmChunk('', 'stop')],
      'other/hy3-documentation',
    )

    expect(toolStarts(events)).toHaveLength(0)
    expect(textOf(events)).toBe(text)
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

  test('recovers Tencent HY3 XML calls without exposing wrapper text', async () => {
    const events = await run([
      hy3Chunk('<tool_call:call_1>TaskCreate\n subject: Verify HY3\n'),
      hy3Chunk(' description: Run the live test\n</tool_call:call_1>'),
      hy3Chunk('', 'stop'),
    ], 'tencent/hy3')
    const starts = toolStarts(events)
    expect(starts).toHaveLength(1)
    expect((starts[0].content_block as Record<string, string>).name).toBe('TaskCreate')
    expect(textOf(events)).not.toContain('<tool_call')
    const jsonDelta = events.find(
      event => event.type === 'content_block_delta' && (event.delta as Record<string, string>)?.type === 'input_json_delta',
    )
    expect(JSON.parse((jsonDelta!.delta as Record<string, string>).partial_json)).toEqual({
      subject: 'Verify HY3',
      description: 'Run the live test',
    })
  })

  test('recovers zero-argument Tencent HY3 calls from streaming output', async () => {
    const events = await run([
      hy3Chunk('<tool_call:call_1>CronList</tool_call:call_1>'),
      hy3Chunk('', 'stop'),
    ], 'tencent/hy3')

    expect(toolStarts(events)).toHaveLength(1)
    expect((toolStarts(events)[0].content_block as Record<string, string>).name).toBe('CronList')
    expect(textOf(events)).not.toContain('<tool_call')
    const jsonDelta = events.find(
      event => event.type === 'content_block_delta' && (event.delta as Record<string, string>)?.type === 'input_json_delta',
    )
    expect(JSON.parse((jsonDelta!.delta as Record<string, string>).partial_json)).toEqual({})
  })

  test('strips a complete Tencent HY3 wrapper from streaming output', async () => {
    const events = await run([
      hy3Chunk('<tool_calls:call_1><tool_call:call_1>TaskCreate\n subject: Verify HY3\n'),
      hy3Chunk(' description: Run the live test\n</tool_call:call_1></tool_calls:call_1>'),
      hy3Chunk('', 'stop'),
    ], 'tencent/hy3')

    expect(toolStarts(events)).toHaveLength(1)
    expect(textOf(events)).not.toContain('<tool_call')
    expect(textOf(events)).not.toContain('</tool_calls')
  })

  test('recovers an HY3 wrapper when its colon suffix is split across SSE deltas', async () => {
    const events = await run([
      hy3Chunk('<tool_calls'),
      hy3Chunk(':call_1><tool_call:call_1>TaskCreate\n subject: Verify HY3\n description: Run the live test\n</tool_call:call_1></tool_calls:call_1>'),
      hy3Chunk('', 'stop'),
    ], 'tencent/hy3')

    expect(toolStarts(events)).toHaveLength(1)
    expect((toolStarts(events)[0].content_block as Record<string, string>).name).toBe('TaskCreate')
    expect(textOf(events)).not.toContain('<tool_calls')
  })

  test('recovers Tencent HY3 official tagged arguments from streaming output', async () => {
    const events = await run([
      hy3Chunk('<tool_calls:opensource><tool_call:opensource>TaskCreate<tool_sep:opensource><arg_key:opensource>subject</arg_key:opensource>'),
      hy3Chunk('<arg_value:opensource>Verify HY3</arg_value:opensource><arg_key:opensource>description</arg_key:opensource><arg_value:opensource>Run the live test</arg_value:opensource></tool_call:opensource></tool_calls:opensource>'),
      hy3Chunk('', 'stop'),
    ], 'tencent/hy3')

    expect(toolStarts(events)).toHaveLength(1)
    expect((toolStarts(events)[0].content_block as Record<string, string>).name).toBe('TaskCreate')
    expect(textOf(events)).not.toContain('<tool_call')
    const jsonDelta = events.find(
      event => event.type === 'content_block_delta' && (event.delta as Record<string, string>)?.type === 'input_json_delta',
    )
    expect(JSON.parse((jsonDelta!.delta as Record<string, string>).partial_json)).toEqual({
      subject: 'Verify HY3',
      description: 'Run the live test',
    })
  })
})

// Self-hosted buffering path (LAN llama-server) enables isOllamaStream-style
// text buffering. XML recovery must still run at finish — otherwise Qwen/GLM
// XML tool calls are flushed as plain text with end_turn. Also cover
// finish_reason tool_calls without structured delta.tool_calls.
describe('Self-hosted streaming — XML tool calls with tools advertised', () => {
  let originalFetch: FetchType
  let originalOpenAIApiKey: string | undefined
  let originalOpenAIBaseUrl: string | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalOpenAIApiKey = process.env.OPENAI_API_KEY
    originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL
    process.env.OPENAI_API_KEY = 'none'
    process.env.OPENAI_BASE_URL = 'http://192.168.1.10:8080/v1'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAIApiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIApiKey
    }
    if (originalOpenAIBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL
    } else {
      process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl
    }
  })

  test('recovers Qwen/GLM XML tool_use from buffered self-hosted stream', async () => {
    const chunk = (content: string, finishReason?: string) => ({
      id: 'chatcmpl-llama',
      object: 'chat.completion.chunk',
      model: 'qwen3.6:35b',
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: finishReason ?? null,
        },
      ],
    })

    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          chunk(
            '<tool_call><function=Bash><parameter=command>pwd</parameter></function></tool_call>',
          ),
          chunk('', 'stop'),
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen3.6:35b',
        messages: [{ role: 'user', content: 'run pwd' }],
        tools: [
          {
            name: 'Bash',
            description: 'run shell',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const starts = events.filter(
      e =>
        e.type === 'content_block_start' &&
        (e.content_block as Record<string, string>)?.type === 'tool_use',
    )
    expect(starts).toHaveLength(1)
    expect((starts[0].content_block as Record<string, string>).name).toBe('Bash')

    const text = events
      .filter(
        e =>
          e.type === 'content_block_delta' &&
          (e.delta as Record<string, string>)?.type === 'text_delta',
      )
      .map(e => (e.delta as Record<string, string>).text)
      .join('')
    expect(text).not.toContain('<tool_call>')
  })

  test('recovers JSON text tools when finish_reason is tool_calls without delta.tool_calls', async () => {
    const chunk = (content: string, finishReason?: string) => ({
      id: 'chatcmpl-llama',
      object: 'chat.completion.chunk',
      model: 'qwen3.6:35b',
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: finishReason ?? null,
        },
      ],
    })

    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          chunk('{"name":"Bash","arguments":{"command":"pwd"}}'),
          chunk('', 'tool_calls'),
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'qwen3.6:35b',
        messages: [{ role: 'user', content: 'run pwd' }],
        tools: [
          {
            name: 'Bash',
            description: 'run shell',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const starts = events.filter(
      e =>
        e.type === 'content_block_start' &&
        (e.content_block as Record<string, string>)?.type === 'tool_use',
    )
    expect(starts).toHaveLength(1)
    expect((starts[0].content_block as Record<string, string>).name).toBe('Bash')

    const messageDelta = events.find(e => e.type === 'message_delta') as
      | Record<string, unknown>
      | undefined
    expect(
      (messageDelta?.delta as Record<string, unknown> | undefined)?.stop_reason,
    ).toBe('tool_use')
  })
})

describe('providerOverride does not inherit parent self-hosted recovery flags', () => {
  let originalFetch: FetchType
  let originalOpenAIApiKey: string | undefined
  let originalOpenAIBaseUrl: string | undefined
  let originalSelfHosted: string | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalOpenAIApiKey = process.env.OPENAI_API_KEY
    originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL
    originalSelfHosted = process.env.OPENAI_SELF_HOSTED_TOOLS
    process.env.OPENAI_API_KEY = 'parent-key'
    // Parent profile is self-hosted with recovery enabled.
    process.env.OPENAI_BASE_URL = 'https://llama.example.com:8443/v1'
    process.env.OPENAI_SELF_HOSTED_TOOLS = '1'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAIApiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIApiKey
    }
    if (originalOpenAIBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL
    } else {
      process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl
    }
    if (originalSelfHosted === undefined) {
      delete process.env.OPENAI_SELF_HOSTED_TOOLS
    } else {
      process.env.OPENAI_SELF_HOSTED_TOOLS = originalSelfHosted
    }
  })

  test('remote override leaves tool-shaped text as text (not tool_use)', async () => {
    const chunk = (content: string, finishReason?: string) => ({
      id: 'chatcmpl-remote',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: finishReason ?? null,
        },
      ],
    })

    globalThis.fetch = (async () =>
      makeSseResponse(
        makeChunks([
          chunk(
            'Here is an example: {"name":"Bash","arguments":{"command":"ls"}}',
          ),
          chunk('', 'stop'),
        ]),
      )) as unknown as FetchType

    const client = createOpenAIShimClient({
      providerOverride: {
        model: 'gpt-4o',
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-override',
      },
    }) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'show an example' }],
        tools: [
          {
            name: 'Bash',
            description: 'run shell',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    const events: Record<string, unknown>[] = []
    for await (const event of result.data) events.push(event)

    const toolStarts = events.filter(
      e =>
        e.type === 'content_block_start' &&
        (e.content_block as Record<string, string>)?.type === 'tool_use',
    )
    expect(toolStarts).toHaveLength(0)

    const text = events
      .filter(
        e =>
          e.type === 'content_block_delta' &&
          (e.delta as Record<string, string>)?.type === 'text_delta',
      )
      .map(e => (e.delta as Record<string, string>).text)
      .join('')
    expect(text).toContain('{"name":"Bash"')
  })
})
