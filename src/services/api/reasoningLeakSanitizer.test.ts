import { describe, expect, test } from 'bun:test'

import {
  looksLikeLeakedReasoningPrefix,
  stripLeakedReasoningPreamble,
} from './reasoningLeakSanitizer.ts'

describe('reasoning leak sanitizer', () => {
  test('strips explicit internal reasoning preambles', () => {
    const text =
      'The user just said "hey" - a simple greeting. I should respond briefly and friendly.\n\nHey! How can I help you today?'

    expect(looksLikeLeakedReasoningPrefix(text)).toBe(true)
    expect(stripLeakedReasoningPreamble(text)).toBe(
      'Hey! How can I help you today?',
    )
  })

  test('does not strip normal user-facing advice that mentions "the user should"', () => {
    const text =
      'The user should reset their password immediately.\n\nHere are the steps...'

    expect(looksLikeLeakedReasoningPrefix(text)).toBe(false)
    expect(stripLeakedReasoningPreamble(text)).toBe(text)
  })
})
