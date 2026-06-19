import { beforeEach, expect, mock, test } from 'bun:test'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../types/message.js'
import {
  createAssistantMessage,
  createUserMessage,
  validateToolResultPairing,
} from '../utils/messages.js'

let capturedMessages: Message[] | null = null

const queryModelWithoutStreamingMock = mock(
  async (params: { messages: Message[] }) => {
    capturedMessages = params.messages
    return createAssistantMessage({
      content: [
        {
          type: 'text',
          text: 'Back to the implementation.',
          citations: [],
        },
      ],
    })
  },
)

mock.module('./api/claude.js', () => ({
  queryModelWithoutStreaming: queryModelWithoutStreamingMock,
}))

mock.module('./SessionMemory/sessionMemoryUtils.js', () => ({
  getSessionMemoryContent: mock(async () => null),
}))

const { generateAwaySummary } = await import('./awaySummary.js')

const RECENT_WINDOW_FOR_TEST = 30

function assistantWithToolUse(id: string): Message {
  return createAssistantMessage({
    content: [
      {
        type: 'tool_use',
        id,
        name: 'Read',
        input: { file_path: '/tmp/example.txt' },
      },
    ],
  })
}

function userWithToolResult(id: string): Message {
  return createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content: 'file contents',
      },
    ],
  })
}

function isPairableMessage(
  message: Message,
): message is UserMessage | AssistantMessage {
  return message.type === 'user' || message.type === 'assistant'
}

function capturedConversationBeforeRecapPrompt(): (UserMessage | AssistantMessage)[] {
  // The last captured message is the recap prompt added by generateAwaySummary.
  return capturedMessages!.slice(0, -1).filter(isPairableMessage)
}

beforeEach(() => {
  capturedMessages = null
  queryModelWithoutStreamingMock.mockClear()
})

test('generateAwaySummary does not start its recent projection with an orphan tool_result', async () => {
  const toolUseId = 'toolu_away_summary'
  const messages: Message[] = [
    assistantWithToolUse(toolUseId),
    userWithToolResult(toolUseId),
  ]

  for (let i = 0; i < RECENT_WINDOW_FOR_TEST - 1; i++) {
    messages.push(createUserMessage({ content: `recent turn ${i}` }))
  }

  const summary = await generateAwaySummary(
    messages,
    new AbortController().signal,
  )

  expect(summary).toBe('Back to the implementation.')
  expect(capturedMessages).not.toBeNull()
  expect(capturedMessages?.[0]?.type).toBe('assistant')
  expect(capturedMessages?.[1]?.type).toBe('user')

  expect(
    validateToolResultPairing(capturedConversationBeforeRecapPrompt()).valid,
  ).toBe(true)
})

test('generateAwaySummary drops an orphaned tool_result instead of expanding beyond the recent window', async () => {
  const toolUseId = 'toolu_away_summary_old'
  const messages: Message[] = [assistantWithToolUse(toolUseId)]

  // Push the matching tool_use beyond the allowed expansion budget.
  for (let i = 0; i < RECENT_WINDOW_FOR_TEST + 5; i++) {
    messages.push(createUserMessage({ content: `older filler ${i}` }))
  }
  messages.push(userWithToolResult(toolUseId))
  for (let i = 0; i < RECENT_WINDOW_FOR_TEST - 1; i++) {
    messages.push(createUserMessage({ content: `recent turn ${i}` }))
  }

  await generateAwaySummary(messages, new AbortController().signal)

  expect(capturedMessages).not.toBeNull()
  expect(capturedMessages?.[0]?.type).toBe('user')
  expect(capturedMessages?.[0]?.message.content).toBe('recent turn 0')

  expect(
    validateToolResultPairing(capturedConversationBeforeRecapPrompt()).valid,
  ).toBe(true)
})
