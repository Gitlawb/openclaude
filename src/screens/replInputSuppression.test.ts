import { describe, expect, it } from 'bun:test'

import { isPromptTypingSuppressionActive } from './replInputSuppression.js'

describe('isPromptTypingSuppressionActive', () => {
  it('suppresses dialogs when early input already exists', () => {
    expect(isPromptTypingSuppressionActive(false, 'hello')).toBe(true)
  })

  it('does not suppress dialogs for empty or whitespace-only input', () => {
    expect(isPromptTypingSuppressionActive(false, '')).toBe(false)
    expect(isPromptTypingSuppressionActive(false, '   ')).toBe(false)
  })

  it('keeps suppression active while the typing flag is set', () => {
    expect(isPromptTypingSuppressionActive(true, '')).toBe(true)
  })
})
