import { beforeEach, describe, expect, it } from 'bun:test'
import { resetStateForTests } from '../cost-tracker.js'
import { getUnreportedSessionUsage } from '../utils/tokens.js'
import {
  buildStatusLineCommandInput,
  resolveStatusLineTokenTotals,
} from './StatusLine.js'
import type { AssistantMessage, Message } from '../types/message.js'

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test-version',
}

const assistantMessage = (
  content: string,
  id = 'msg_unsupported',
): AssistantMessage =>
  ({
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000001',
    timestamp: '2026-06-28T00:00:00.000Z',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'mimo-v2.5-pro',
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }) as unknown as AssistantMessage

const userMessage = (content: string): Message =>
  ({
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000002',
    timestamp: '2026-06-28T00:00:00.000Z',
    message: {
      role: 'user',
      content,
    },
  }) as Message

describe('resolveStatusLineTokenTotals', () => {
  it('keeps reported usage totals unchanged', () => {
    expect(resolveStatusLineTokenTotals(1200, 300, null)).toEqual({
      totalInputTokens: 1200,
      totalOutputTokens: 300,
      totalTokensAreEstimated: undefined,
    })
  })

  it('adds unreported session usage to cumulative session totals', () => {
    expect(
      resolveStatusLineTokenTotals(1200, 300, {
        input_tokens: 90,
        output_tokens: 20,
      }),
    ).toEqual({
      totalInputTokens: 1290,
      totalOutputTokens: 320,
      totalTokensAreEstimated: true,
    })
  })
})

describe('buildStatusLineCommandInput', () => {
  beforeEach(() => {
    resetStateForTests()
  })

  it('emits estimated cumulative totals for unreported provider usage', () => {
    const messages = [
      userMessage('Please summarize this repository.'),
      assistantMessage('This repository contains source files and tests.'),
    ]
    const unreportedUsage = getUnreportedSessionUsage(messages)
    expect(unreportedUsage).not.toBeNull()

    const input = buildStatusLineCommandInput(
      'default',
      false,
      {},
      messages,
      [],
      'mimo-v2.5-pro',
    )

    expect(input.context_window).toMatchObject({
      total_input_tokens: unreportedUsage!.input_tokens,
      total_output_tokens: unreportedUsage!.output_tokens,
      total_tokens_are_estimated: true,
      current_usage: {
        is_estimated: true,
      },
    })
  })
})
