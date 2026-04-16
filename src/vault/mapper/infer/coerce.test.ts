import { describe, test, expect } from 'bun:test'
import { coerceSemanticResponse } from './coerce.js'

describe('coerceSemanticResponse', () => {
  const valid = {
    summary: 'Handles user authentication and session management.',
    responsibilities: ['Validate credentials', 'Issue tokens', 'Expire sessions'],
    domain: 'auth',
    layer: 'service',
  }

  test('valid input returns populated result with fallback=false', () => {
    const result = coerceSemanticResponse(valid, 100, 50)
    expect(result.fallback).toBe(false)
    expect(result.summary).toBe(valid.summary)
    expect(result.responsibilities).toEqual(valid.responsibilities)
    expect(result.domain).toBe('auth')
    expect(result.layer).toBe('service')
    expect(result.tokensIn).toBe(100)
    expect(result.tokensOut).toBe(50)
  })

  test('null input returns fallback', () => {
    const result = coerceSemanticResponse(null)
    expect(result.fallback).toBe(true)
    expect(result.summary).toContain('pending')
    expect(result.responsibilities).toHaveLength(3)
    expect(result.layer).toBe('unknown')
  })

  test('undefined input returns fallback', () => {
    const result = coerceSemanticResponse(undefined)
    expect(result.fallback).toBe(true)
  })

  test('non-object input returns fallback', () => {
    const result = coerceSemanticResponse('just a string')
    expect(result.fallback).toBe(true)
  })

  test('missing summary returns fallback', () => {
    const { summary: _, ...noSummary } = valid
    const result = coerceSemanticResponse(noSummary)
    expect(result.fallback).toBe(true)
  })

  test('responsibilities with fewer than 3 items returns fallback', () => {
    const result = coerceSemanticResponse({
      ...valid,
      responsibilities: ['only one'],
    })
    expect(result.fallback).toBe(true)
  })

  test('empty responsibilities array returns fallback', () => {
    const result = coerceSemanticResponse({
      ...valid,
      responsibilities: [],
    })
    expect(result.fallback).toBe(true)
  })

  test('invalid domain pattern returns fallback', () => {
    const result = coerceSemanticResponse({
      ...valid,
      domain: '123-bad-start',
    })
    expect(result.fallback).toBe(true)
  })

  test('unknown layer value coerces to "unknown"', () => {
    const result = coerceSemanticResponse({
      ...valid,
      layer: 'backend',
    })
    expect(result.fallback).toBe(false)
    expect(result.layer).toBe('unknown')
  })

  test('summary is truncated to 160 chars', () => {
    const result = coerceSemanticResponse({
      ...valid,
      summary: 'x'.repeat(200),
    })
    expect(result.fallback).toBe(false)
    expect(result.summary).toHaveLength(160)
  })

  test('responsibilities capped at 7', () => {
    const result = coerceSemanticResponse({
      ...valid,
      responsibilities: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    })
    expect(result.fallback).toBe(false)
    expect(result.responsibilities).toHaveLength(7)
  })

  test('tokens are preserved even on fallback', () => {
    const result = coerceSemanticResponse(null, 200, 100)
    expect(result.tokensIn).toBe(200)
    expect(result.tokensOut).toBe(100)
  })

  test('domain is lowercased and trimmed', () => {
    const result = coerceSemanticResponse({
      ...valid,
      domain: '  Auth  ',
    })
    expect(result.fallback).toBe(false)
    expect(result.domain).toBe('auth')
  })
})
