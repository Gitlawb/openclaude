import { describe, expect, test } from 'bun:test'

import {
  formatMaxFileReadTokenExceededMessage,
  MaxFileReadTokenExceededError,
} from './FileReadTool.js'

describe('oversized FileReadTool guidance', () => {
  test('includes token limit, total lines, and concrete Read ranges', () => {
    const message = formatMaxFileReadTokenExceededMessage(12_345, 8_000, {
      filePath: '/repo/src/big.ts',
      source: 'estimate',
      totalLines: 450,
    })

    expect(message).toContain('estimated 12,345 tokens')
    expect(message).toContain('limit 8,000 tokens')
    expect(message).toContain('450 total lines')
    expect(message).toContain(
      '{"file_path":"/repo/src/big.ts","offset":1,"limit":200}',
    )
    expect(message).toContain(
      '{"file_path":"/repo/src/big.ts","offset":201,"limit":200}',
    )
    expect(message).toContain('Use Grep first')
  })

  test('marks API-counted token counts without calling them estimates', () => {
    const message = formatMaxFileReadTokenExceededMessage(9_001, 9_000, {
      source: 'api',
    })

    expect(message).toContain('9,001 tokens')
    expect(message).not.toContain('estimated 9,001 tokens')
  })

  test('MaxFileReadTokenExceededError preserves metadata on the error object', () => {
    const error = new MaxFileReadTokenExceededError(3_001, 3_000, {
      filePath: '/repo/large.log',
      source: 'estimate',
      totalLines: 250,
    })

    expect(error.name).toBe('MaxFileReadTokenExceededError')
    expect(error.tokenCount).toBe(3_001)
    expect(error.maxTokens).toBe(3_000)
    expect(error.details).toEqual({
      filePath: '/repo/large.log',
      source: 'estimate',
      totalLines: 250,
    })
    expect(error.message).toContain('250 total lines')
  })
})
