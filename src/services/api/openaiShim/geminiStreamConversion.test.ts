import { expect, test } from 'bun:test'
import {
  createReaderCanceller,
  createStreamAbortError,
  readWithIdleTimeout,
  throwIfStreamAborted,
} from './streamControl.js'
import { geminiSseToAnthropic } from './geminiStreamConversion.js'

const dependencies = {
  createReaderCanceller,
  createStreamAbortError,
  getStreamIdleTimeoutMs: () => 1_000,
  makeMessageId: () => 'msg_gemini_test',
  readWithIdleTimeout,
  throwIfStreamAborted,
}

function responseFor(...payloads: Array<Record<string, unknown>>): Response {
  const frames = [
    ...payloads.map(payload => `data: ${JSON.stringify(payload)}\n\n`),
    'data: [DONE]\n\n',
  ].join('')
  return new Response(new TextEncoder().encode(frames), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

test('converts Gemini text, tool calls, usage, and finish state', async () => {
  const response = responseFor({
    candidates: [{
      content: {
        parts: [
          { text: 'Inspecting.' },
          { functionCall: { name: 'Read', args: { file_path: 'a.ts' } } },
        ],
      },
      finishReason: 'STOP',
    }],
    usageMetadata: {
      promptTokenCount: 4,
      candidatesTokenCount: 2,
      thoughtsTokenCount: 1,
    },
  })
  const events: Array<Record<string, unknown>> = []

  for await (const event of geminiSseToAnthropic(
    response,
    'gemini-test',
    undefined,
    dependencies,
  )) {
    events.push(event as unknown as Record<string, unknown>)
  }

  expect(events[0]).toMatchObject({
    type: 'message_start',
    message: { id: 'msg_gemini_test', model: 'gemini-test' },
  })
  expect(events.some(event =>
    event.type === 'content_block_delta' &&
    (event.delta as { text?: string })?.text === 'Inspecting.',
  )).toBe(true)
  expect(events.some(event =>
    event.type === 'content_block_start' &&
    (event.content_block as { name?: string })?.name === 'Read',
  )).toBe(true)
  expect(events.at(-2)).toMatchObject({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use' },
    usage: { input_tokens: 4, output_tokens: 3 },
  })
  expect(events.at(-1)).toEqual({ type: 'message_stop' })
})

test('rejects an already-aborted Gemini stream without yielding events', async () => {
  const controller = new AbortController()
  controller.abort()
  const stream = geminiSseToAnthropic(
    responseFor({ candidates: [] }),
    'gemini-test',
    controller.signal,
    dependencies,
  )

  await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' })
})
