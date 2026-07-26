import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

const realThinking = await import(`./thinking.js?real=${Date.now()}-${Math.random()}`)
mock.module('./thinking.js', () => ({
  ...realThinking,
  isUltrathinkEnabled: () => true,
}))

const { getUltrathinkEffortAttachment } = await import(
  `./attachments.ts?test=${Date.now()}-${Math.random()}`
)

const savedEnv = {
  disableAttachments: process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS,
  simple: process.env.CLAUDE_CODE_SIMPLE,
}

beforeEach(() => {
  delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
  delete process.env.CLAUDE_CODE_SIMPLE
})

afterEach(() => {
  if (savedEnv.disableAttachments === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
  } else {
    process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = savedEnv.disableAttachments
  }
  if (savedEnv.simple === undefined) {
    delete process.env.CLAUDE_CODE_SIMPLE
  } else {
    process.env.CLAUDE_CODE_SIMPLE = savedEnv.simple
  }
})

test('ultrathink helper honors global attachment opt-outs', () => {
  expect(getUltrathinkEffortAttachment('ultrathink solve this', false)).toEqual([
    { type: 'ultrathink_effort', level: 'high' },
  ])

  process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = '1'
  expect(getUltrathinkEffortAttachment('ultrathink solve this', false)).toEqual([])

  delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
  process.env.CLAUDE_CODE_SIMPLE = '1'
  expect(getUltrathinkEffortAttachment('ultrathink solve this', false)).toEqual([])
})
