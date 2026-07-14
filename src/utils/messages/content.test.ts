import { expect, test } from 'bun:test'
import {
  extractTag,
  extractTextContent,
  getAssistantMessageText,
  getContentText,
  isEmptyMessageText,
  stripPromptXMLTags,
  textForResubmit,
} from './content.js'

function userMessage(content: string) {
  return {
    type: 'user',
    message: { content },
  } as never
}

test('extractTextContent joins only text blocks', () => {
  expect(
    extractTextContent(
      [
        { type: 'text', text: 'alpha' } as { type: string; text: string },
        { type: 'image' },
        { type: 'text', text: 'beta' } as { type: string; text: string },
      ],
      '\n',
    ),
  ).toBe('alpha\nbeta')
})

test('getContentText returns null for array content without text', () => {
  expect(getContentText([{ type: 'image' } as never])).toBeNull()
})

test('textForResubmit extracts bash-input commands', () => {
  const message = userMessage('<bash-input>git status</bash-input>')

  expect(textForResubmit(message)).toEqual({
    text: 'git status',
    mode: 'bash',
  })
})

test('textForResubmit extracts slash commands and strips IDE context from plain text', () => {
  const commandMessage = userMessage(
    '<command-name>review</command-name><command-args>pr 1901</command-args>',
  )
  expect(textForResubmit(commandMessage)).toEqual({
    text: 'review pr 1901',
    mode: 'prompt',
  })

  const plainMessage = userMessage(
    '<ide_opened_file>/tmp/noise.ts</ide_opened_file>\nplease review this',
  )
  expect(textForResubmit(plainMessage)).toEqual({
    text: 'please review this',
    mode: 'prompt',
  })
})

test('isEmptyMessageText treats stripped tag-only and sentinel text as empty', () => {
  expect(isEmptyMessageText('<context>hidden</context>')).toBe(true)
  expect(isEmptyMessageText('(no content)')).toBe(true)
  expect(isEmptyMessageText('hello')).toBe(false)
})

test('getAssistantMessageText joins text blocks for assistant messages', () => {
  const message = {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'alpha' },
        { type: 'tool_use', id: 'toolu_1' },
        { type: 'text', text: 'beta' },
      ],
    },
  } as never

  expect(getAssistantMessageText(message)).toBe('alpha\nbeta')
})

test('extractTag handles attributes and stripPromptXMLTags removes hidden blocks', () => {
  expect(extractTag('<command-name data-x="1">review</command-name>', 'command-name')).toBe(
    'review',
  )
  expect(stripPromptXMLTags('<context>hidden</context>\nvisible')).toBe('visible')
})
