import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mcpContentNeedsTruncation, truncateMcpContent } from './mcpValidation.js'

// Mutable state shared between mock factories and test cases via closure.
// Factories close over this object and read it at call time, so per-test
// mutations (e.g. tokenState.apiReturn = 1000) take effect correctly.
const tokenState = {
  // > DEFAULT_MAX_MCP_OUTPUT_TOKENS * MCP_TOKEN_COUNT_THRESHOLD_FACTOR (12500)
  // so the rough-count early-return is bypassed and the API is always called.
  roughCount: 26000,
  apiReturn: null as number | null,
}

mock.module('../services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => null,
}))

mock.module('../services/tokenEstimation.js', () => ({
  roughTokenCountEstimation: () => tokenState.roughCount,
  countMessagesTokensWithAPI: async () => tokenState.apiReturn,
}))

mock.module('./imageResizer.js', () => ({
  compressImageBlock: async (block: unknown) => block,
}))

mock.module('./log.js', () => ({ logError: () => {} }))

// ---------- SEC-04: fail-closed on null ----------

describe('mcpContentNeedsTruncation — SEC-04 fail-closed on null', () => {
  beforeEach(() => {
    tokenState.roughCount = 26000
    tokenState.apiReturn = null
    process.env.MAX_MCP_OUTPUT_TOKENS = ''
  })

  afterEach(() => {
    process.env.MAX_MCP_OUTPUT_TOKENS = ''
  })

  test('null token count returns true (fail-closed)', async () => {
    tokenState.apiReturn = null
    expect(await mcpContentNeedsTruncation('x'.repeat(500))).toBe(true)
  })

  test('token count below limit returns false', async () => {
    tokenState.apiReturn = 1000
    expect(await mcpContentNeedsTruncation('x'.repeat(500))).toBe(false)
  })

  test('token count above limit returns true', async () => {
    tokenState.apiReturn = 26000
    expect(await mcpContentNeedsTruncation('x'.repeat(500))).toBe(true)
  })

  test('token count exactly at limit returns false', async () => {
    tokenState.apiReturn = 25000
    expect(await mcpContentNeedsTruncation('x'.repeat(500))).toBe(false)
  })
})

// ---------- SEC-05: output stays within budget ----------

describe('truncateMcpContent — SEC-05 budget invariant', () => {
  beforeEach(() => {
    process.env.MAX_MCP_OUTPUT_TOKENS = ''
  })

  afterEach(() => {
    process.env.MAX_MCP_OUTPUT_TOKENS = ''
  })

  test('string result does not exceed maxChars when notice exceeds budget', async () => {
    // MAX_MCP_OUTPUT_TOKENS=1 → maxChars=4; notice is ~200 chars → exceeds budget.
    // Before the fix: budget=0, result = '' + notice (overflow). After: sliced to maxChars.
    process.env.MAX_MCP_OUTPUT_TOKENS = '1'
    const result = await truncateMcpContent('x'.repeat(500))
    expect(typeof result).toBe('string')
    expect((result as string).length).toBeLessThanOrEqual(4)
  })

  test('block result total chars do not exceed maxChars when notice exceeds budget', async () => {
    process.env.MAX_MCP_OUTPUT_TOKENS = '1'
    const result = await truncateMcpContent([
      { type: 'text', text: 'x'.repeat(500) },
    ] as Parameters<typeof truncateMcpContent>[0])
    expect(Array.isArray(result)).toBe(true)
    const totalChars = (result as Array<{ type: string; text?: string }>).reduce(
      (sum, b) => sum + (b.text?.length ?? 0),
      0,
    )
    expect(totalChars).toBeLessThanOrEqual(4)
  })

  test('string result within standard budget includes notice', async () => {
    // Default MAX_MCP_OUTPUT_TOKENS=25000 → maxChars=100000.
    // 500-char content + notice << 100000 → content is preserved intact.
    const result = await truncateMcpContent('x'.repeat(500))
    expect(typeof result).toBe('string')
    expect((result as string).length).toBeLessThanOrEqual(25000 * 4)
    expect(result as string).toContain('[OUTPUT TRUNCATED')
  })
})
