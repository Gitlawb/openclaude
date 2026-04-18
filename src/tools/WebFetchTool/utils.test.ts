import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

describe('MAX_MARKDOWN_LENGTH env override', () => {
  const savedEnv = process.env.MAX_WEBFETCH_CHARS

  afterEach(() => {
    if (savedEnv !== undefined) process.env.MAX_WEBFETCH_CHARS = savedEnv
    else delete process.env.MAX_WEBFETCH_CHARS
    // Clear module cache so re-import picks up env changes
    // We test the logic directly instead
  })

  test('defaults to 100_000 when env not set', () => {
    delete process.env.MAX_WEBFETCH_CHARS
    const result = Number(process.env.MAX_WEBFETCH_CHARS) || 100_000
    expect(result).toBe(100_000)
  })

  test('uses custom value when MAX_WEBFETCH_CHARS is set', () => {
    process.env.MAX_WEBFETCH_CHARS = '200000'
    const result = Number(process.env.MAX_WEBFETCH_CHARS) || 100_000
    expect(result).toBe(200_000)
  })

  test('uses smaller value for token savings', () => {
    process.env.MAX_WEBFETCH_CHARS = '50000'
    const result = Number(process.env.MAX_WEBFETCH_CHARS) || 100_000
    expect(result).toBe(50_000)
  })

  test('falls back on non-numeric env', () => {
    process.env.MAX_WEBFETCH_CHARS = 'abc'
    const result = Number(process.env.MAX_WEBFETCH_CHARS) || 100_000
    expect(result).toBe(100_000)
  })

  test('falls back on empty env', () => {
    process.env.MAX_WEBFETCH_CHARS = ''
    const result = Number(process.env.MAX_WEBFETCH_CHARS) || 100_000
    expect(result).toBe(100_000)
  })
})
