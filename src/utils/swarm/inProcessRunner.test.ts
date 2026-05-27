import { expect, test } from 'bun:test'
import { pruneMessagesToSlidingWindow } from './inProcessRunner.js'
import type { Message } from '../../types/message.js'

test('pruneMessagesToSlidingWindow leaves small message arrays untouched', () => {
  const messages: Message[] = [
    {
      uuid: 'msg-1',
      type: 'user',
      message: { role: 'user', content: 'Hello' },
    },
    {
      uuid: 'msg-2',
      type: 'assistant',
      message: { role: 'assistant', content: 'Hi there' },
    },
  ]
  const result = pruneMessagesToSlidingWindow(messages, 5, 2)
  expect(result).toEqual(messages)
})

test('pruneMessagesToSlidingWindow prunes to a user message start', () => {
  const messages: Message[] = [
    {
      uuid: 'msg-1',
      type: 'user',
      message: { role: 'user', content: 'Hello' },
    },
    {
      uuid: 'msg-2',
      type: 'assistant',
      message: { role: 'assistant', content: 'Hi there' },
    },
    {
      uuid: 'msg-3',
      type: 'user',
      message: { role: 'user', content: 'What is 2+2?' },
    },
    {
      uuid: 'msg-4',
      type: 'assistant',
      message: { role: 'assistant', content: '4' },
    },
    {
      uuid: 'msg-5',
      type: 'user',
      message: { role: 'user', content: 'Thank you' },
    },
  ]
  // maxMessages=4, minRetain=3
  // targetIndex is 5 - 3 = 2.
  // Suffix should start at msg-3 (index 2) which is a user message.
  const result = pruneMessagesToSlidingWindow(messages, 4, 3)
  expect(result.length).toBe(3)
  expect(result[0].uuid).toBe('msg-3')
})

test('pruneMessagesToSlidingWindow does not split tool_use / tool_result pairs', () => {
  const messages: Message[] = [
    {
      uuid: 'msg-1',
      type: 'user',
      message: { role: 'user', content: 'Start task' },
    },
    {
      uuid: 'msg-2',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Using tool' },
          { type: 'tool_use', id: 'tool-1', name: 'my_tool', input: {} },
        ],
      },
    },
    {
      uuid: 'msg-3',
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'success' },
        ],
      },
    },
    {
      uuid: 'msg-4',
      type: 'assistant',
      message: { role: 'assistant', content: 'Tool finished' },
    },
    {
      uuid: 'msg-5',
      type: 'user',
      message: { role: 'user', content: 'Next step' },
    },
  ]
  // If we try to split at index 2 (msg-3), that would place the tool result after the split but tool use before.
  // Thus, it should find splitIndex at index 0 (msg-1) or not split at all if index 0 is too far.
  // In this case, since we scan back from targetIndex, index 2 is invalid because of tool-1 dangling.
  // So it should fallback to a safe index before the tool use, e.g. index 0 (msg-1).
  const result = pruneMessagesToSlidingWindow(messages, 4, 3)
  expect(result.length).toBe(5) // cannot prune to 3 or 4 messages without splitting tool-1, so returns original array
})
