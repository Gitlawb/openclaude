import { expect, test } from 'bun:test'
import {
  convertGeminiToAnthropicResponse,
  parseTextToolCalls,
  parseXmlToolCalls,
} from './responseAdapters.js'

test('raw-text and XML fallback tool calls use one unique sequence', () => {
  const text = parseTextToolCalls('{"name":"from_text","arguments":{}}')
  const xml = parseXmlToolCalls(
    '<tool_call>{"name":"from_xml","arguments":{}}</tool_call>',
  )

  expect(text.calls[0]?.id).toMatch(/^ollama_tc_\d+$/)
  expect(xml.calls[0]?.id).toMatch(/^xml_tc_\d+$/)
  const textSequence = Number(text.calls[0]?.id?.replace(/^\D+/, ''))
  const xmlSequence = Number(xml.calls[0]?.id?.replace(/^\D+/, ''))
  expect(xmlSequence).toBe(textSequence + 1)
})

test('converts Gemini text and function calls into an Anthropic message', () => {
  const message = convertGeminiToAnthropicResponse({
    candidates: [{
      content: {
        parts: [
          { text: 'Checking the workspace.' },
          { functionCall: { name: 'Read', args: { file_path: 'a.ts' } } },
        ],
      },
      finishReason: 'STOP',
    }],
    usageMetadata: {
      promptTokenCount: 5,
      candidatesTokenCount: 3,
      thoughtsTokenCount: 2,
    },
  }, 'gemini-test')

  expect(message).toMatchObject({
    type: 'message',
    role: 'assistant',
    model: 'gemini-test',
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: 'Checking the workspace.' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
    ],
    usage: { input_tokens: 5, output_tokens: 5 },
  })
})

test('maps Gemini max-token completion without tool calls', () => {
  const message = convertGeminiToAnthropicResponse({
    candidates: [{
      content: { parts: [{ text: 'partial' }] },
      finishReason: 'MAX_TOKENS',
    }],
  }, 'gemini-test')

  expect(message.stop_reason).toBe('max_tokens')
  expect(message.content).toEqual([{ type: 'text', text: 'partial' }])
})
