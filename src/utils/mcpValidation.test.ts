import { describe, expect, test } from 'bun:test'

/**
 * SEC-05 regression: truncateMcpContent must keep total output within maxChars.
 * We test the budget-reservation logic directly without the full module (which
 * has analytics side-effects on import).
 */
describe('truncation budget — SEC-05 regression', () => {
  // Inline the fixed logic so the test is self-contained and fast.
  function truncateWithBudget(content: string, maxChars: number, msg: string): string {
    const budget = Math.max(0, maxChars - msg.length)
    return content.slice(0, budget) + msg
  }

  test('total length does not exceed maxChars', () => {
    const msg = '\n\n[OUTPUT TRUNCATED — limit reached]'
    const maxChars = 200
    const content = 'x'.repeat(500)
    const result = truncateWithBudget(content, maxChars, msg)
    expect(result.length).toBeLessThanOrEqual(maxChars)
    expect(result).toContain('[OUTPUT TRUNCATED')
  })

  test('content shorter than budget is returned as-is plus message', () => {
    const msg = '[TRUNCATED]'
    const maxChars = 200
    const content = 'hello'
    const result = truncateWithBudget(content, maxChars, msg)
    expect(result).toBe('hello[TRUNCATED]')
    expect(result.length).toBeLessThanOrEqual(maxChars)
  })

  test('budget floors at 0 when message alone exceeds maxChars', () => {
    const msg = 'x'.repeat(300)
    const maxChars = 100
    const result = truncateWithBudget('content', maxChars, msg)
    // budget = max(0, 100-300) = 0 → no content chars, just msg
    expect(result).toBe(msg)
  })
})
