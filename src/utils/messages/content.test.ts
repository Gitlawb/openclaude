import { expect, test } from 'bun:test'
import { createUserMessage } from '../messages.js'
import {
  extractTag,
  extractTextContent,
  getContentText,
  stripPromptXMLTags,
  textForResubmit,
} from './content.js'

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
  const message = createUserMessage({
    content: '<bash-input>git status</bash-input>',
  })

  expect(textForResubmit(message)).toEqual({
    text: 'git status',
    mode: 'bash',
  })
})

test('extractTag handles attributes and stripPromptXMLTags removes hidden blocks', () => {
  expect(extractTag('<command-name data-x="1">review</command-name>', 'command-name')).toBe(
    'review',
  )
  expect(stripPromptXMLTags('<context>hidden</context>\nvisible')).toBe('visible')
})
