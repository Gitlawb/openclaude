import { expect, test } from 'bun:test'
import { finishInterruptedMessages } from './finishInterruptedMessages.js'
import { createAssistantMessage, createUserMessage } from './messages.js'

test('closes only unfinished tool calls and preserves partial text and history', () => {
  const assistant = createAssistantMessage({ content: [
    { type: 'tool_use', id: 'done', name: 'Read', input: {} },
    { type: 'tool_use', id: 'pending', name: 'Agent', input: {} },
  ] })
  const done = createUserMessage({ content: [
    { type: 'tool_result', tool_use_id: 'done', content: 'read result' },
  ] })
  const history = [assistant, done]
  const result = finishInterruptedMessages(history, 'Partial answer')
  expect(history).toHaveLength(2)
  expect(result.slice(0, 2)).toEqual(history)
  const toolResults = result.flatMap(m => m.type === 'user' && Array.isArray(m.message.content)
    ? m.message.content.filter(b => b.type === 'tool_result') : [])
  expect(toolResults).toEqual([
    { type: 'tool_result', tool_use_id: 'done', content: 'read result' },
    { type: 'tool_result', tool_use_id: 'pending', is_error: true,
      content: 'Tool execution interrupted by the user.' },
  ])
  expect(JSON.stringify(result)).toContain('Partial answer')
})
