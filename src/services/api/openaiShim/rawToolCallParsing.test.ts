import { expect, test } from 'bun:test'
import {
  couldBeRawToolCallsRequestedPrefix,
  parseRawToolCallsRequestedText,
  repairPossiblyTruncatedObjectJson,
} from './rawToolCallParsing.js'

test('parses a Gemini raw tool call accumulated across stream chunks', () => {
  const accumulated = [
    'Tool calls',
    ' requested:\n- Write({"file_path":"style.css","content":"ul { padding: 0; }"}) [id: call79435b5a26564619b0151197]',
  ].join('')

  expect(couldBeRawToolCallsRequestedPrefix('Tool calls')).toBe(true)
  expect(parseRawToolCallsRequestedText(accumulated)).toEqual([{
    id: 'call79435b5a26564619b0151197',
    name: 'Write',
    argumentsJson: JSON.stringify({
      file_path: 'style.css',
      content: 'ul { padding: 0; }',
    }),
  }])
})

test('parses a complete Gemini raw tool-call response', () => {
  const parsed = parseRawToolCallsRequestedText(
    'Tool calls requested:\n- Agent({"description":"Verify the todo list application functionality.","prompt":"Check files.","subagent_type":"verification"}) [id: call9a8b7c6d5e4f3a2b1c0d9e8f]',
  )

  expect(parsed).toEqual([{
    id: 'call9a8b7c6d5e4f3a2b1c0d9e8f',
    name: 'Agent',
    argumentsJson: JSON.stringify({
      description: 'Verify the todo list application functionality.',
      prompt: 'Check files.',
      subagent_type: 'verification',
    }),
  }])
})

test('JSON fallback: recovers raw-text tool call into tool_use block', () => {
  expect(parseRawToolCallsRequestedText(
    'Tool calls requested:\n- Bash({"command":"ls"}) [id: call_raw_1]',
  )).toEqual([{
    id: 'call_raw_1',
    name: 'Bash',
    argumentsJson: '{"command":"ls"}',
  }])
})

test('rejects malformed raw tool-call request text atomically', () => {
  expect(parseRawToolCallsRequestedText('ordinary prose')).toBeNull()
  expect(parseRawToolCallsRequestedText('Tool calls requested:')).toBeNull()
  expect(parseRawToolCallsRequestedText(
    'Tool calls requested:\n- Bash({"command":"ls"}) [id: ok]\nmalformed',
  )).toBeNull()
})

test('repairs only JSON objects with bounded suffixes', () => {
  expect(repairPossiblyTruncatedObjectJson('{"command":"ls"')).toBe(
    '{"command":"ls"}',
  )
  expect(repairPossiblyTruncatedObjectJson('[]')).toBeNull()
  expect(repairPossiblyTruncatedObjectJson('false')).toBeNull()
  expect(repairPossiblyTruncatedObjectJson('{not json')).toBeNull()
})

test('repairs truncated structured Bash JSON in streaming responses', () => {
  expect(repairPossiblyTruncatedObjectJson('{"command":"pwd"')).toBe(
    '{"command":"pwd"}',
  )
})

test('repairs truncated JSON objects even without command field', () => {
  expect(repairPossiblyTruncatedObjectJson('{"cwd":"/tmp"')).toBe(
    '{"cwd":"/tmp"}',
  )
})
