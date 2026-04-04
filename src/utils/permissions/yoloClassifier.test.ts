import { describe, expect, test } from 'bun:test'

import { buildTranscriptForClassifier } from './yoloClassifier.js'

const tools = [
  {
    name: 'Bash',
    aliases: [],
    toAutoClassifierInput(input: Record<string, unknown>) {
      return String(input.command ?? '')
    },
  },
] as any

describe('buildTranscriptForClassifier', () => {
  test('keeps the most recent transcript entries within budget', () => {
    const messages = [
      {
        type: 'user',
        message: {
          content: 'old-user',
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'old-tool' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: 'new-user',
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'new-tool' },
            },
          ],
        },
      },
    ] as any

    const transcript = buildTranscriptForClassifier(messages, tools, 32)

    expect(transcript).toContain('new-user')
    expect(transcript).toContain('new-tool')
    expect(transcript).not.toContain('old-user')
    expect(transcript).not.toContain('old-tool')
  })

  test('truncates oversized user blocks before serialization', () => {
    const messages = [
      {
        type: 'user',
        message: {
          content: 'x'.repeat(40_000),
        },
      },
    ] as any

    const transcript = buildTranscriptForClassifier(messages, tools)

    expect(transcript.length).toBeLessThan(33_000)
    expect(transcript).toContain('[truncated ')
  })
})
