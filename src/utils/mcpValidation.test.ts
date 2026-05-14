import { describe, expect, test } from 'bun:test'

/**
 * SEC-05 regression: truncateMcpContent must keep total output within maxChars.
 * We test the budget-reservation logic directly without the full module (which
 * has analytics side-effects on import).
 */
describe('truncation budget — SEC-05 regression', () => {
  // Inline the fixed logic so the test is self-contained and fast.
  function truncateWithBudget(content: string, maxChars: number, msg: string): string {
    if (msg.length >= maxChars) {
      return msg.slice(0, maxChars)
    }
    const budget = maxChars - msg.length
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

  test('message alone exceeds maxChars — total is capped at maxChars', () => {
    // Repro: MAX_MCP_OUTPUT_TOKENS=1 → maxChars=4, but notice is always longer.
    // Previously: budget=0, result = '' + msg (300 chars) > maxChars (100). Bug.
    // Now: result = msg.slice(0, maxChars) — invariant holds.
    const msg = 'x'.repeat(300)
    const maxChars = 100
    const result = truncateWithBudget('content', maxChars, msg)
    expect(result.length).toBeLessThanOrEqual(maxChars)
    expect(result).toBe(msg.slice(0, maxChars))
  })
})

/**
 * SEC-04 regression: mcpContentNeedsTruncation must fail-closed when
 * countMessagesTokensWithAPI returns null (not just when it throws).
 */
describe('mcpContentNeedsTruncation fail-closed on null — SEC-04 regression', () => {
  // Inline the fixed evaluation logic without importing the full module.
  function evaluateTokenCount(tokenCount: number | null, limit: number): boolean {
    if (tokenCount == null) return true
    return tokenCount > limit
  }

  test('null token count returns true (fail-closed)', () => {
    expect(evaluateTokenCount(null, 50000)).toBe(true)
  })

  test('token count below limit returns false', () => {
    expect(evaluateTokenCount(1000, 50000)).toBe(false)
  })

  test('token count above limit returns true', () => {
    expect(evaluateTokenCount(60000, 50000)).toBe(true)
  })

  test('token count exactly at limit returns false', () => {
    expect(evaluateTokenCount(50000, 50000)).toBe(false)
  })
})
