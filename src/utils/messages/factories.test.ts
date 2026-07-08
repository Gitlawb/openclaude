import { expect, test } from 'bun:test'
import {
  createAssistantMessage,
  createToolResultStopMessage,
  createUserMessage,
  formatCommandInputTags,
} from './factories.js'

test('createAssistantMessage builds a synthetic assistant message', () => {
  const message = createAssistantMessage({ content: 'hello' })

  expect(message.type).toBe('assistant')
  expect(message.message.content[0]).toMatchObject({
    type: 'text',
    text: 'hello',
  })
})

test('createUserMessage preserves metadata and normalizes empty content', () => {
  const message = createUserMessage({ content: '', isMeta: true })

  expect(message.type).toBe('user')
  expect(message.isMeta).toBe(true)
  expect(message.message.content).toBe('(no content)')
})

test('formatCommandInputTags and createToolResultStopMessage retain public shape', () => {
  expect(formatCommandInputTags('model', 'sonnet')).toContain('<command-name>')
  expect(createToolResultStopMessage('toolu_1')).toMatchObject({
    type: 'tool_result',
    tool_use_id: 'toolu_1',
    is_error: true,
  })
})
