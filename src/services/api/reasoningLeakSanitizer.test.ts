import { describe, expect, test } from 'bun:test'

import {
  looksLikeLeakedReasoningPrefix,
  shouldBufferPotentialReasoningPrefix,
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
    expect(shouldBufferPotentialReasoningPrefix(text)).toBe(false)
    expect(stripLeakedReasoningPreamble(text)).toBe(text)
  })

  test('does not strip legitimate first-person advice about responding to an incident', () => {
    const text =
      'I need to respond to this security incident immediately. The system is compromised.\n\nHere are the remediation steps...'

    expect(looksLikeLeakedReasoningPrefix(text)).toBe(false)
    expect(shouldBufferPotentialReasoningPrefix(text)).toBe(false)
    expect(stripLeakedReasoningPreamble(text)).toBe(text)
  })

  test('does not strip legitimate first-person advice about answering a support ticket', () => {
    const text =
      'I need to answer the support ticket before end of day. The customer is waiting.\n\nHere is the response I drafted...'

    expect(looksLikeLeakedReasoningPrefix(text)).toBe(false)
    expect(shouldBufferPotentialReasoningPrefix(text)).toBe(false)
    expect(stripLeakedReasoningPreamble(text)).toBe(text)
  })
})
