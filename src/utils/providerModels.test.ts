import { describe, expect, test } from 'bun:test'

import {
  getPrimaryModel,
  hasMultipleModels,
  parseModelList,
} from './providerModels.ts'

// ── parseModelList ────────────────────────────────────────────────────────────

describe('parseModelList', () => {
  test('splits comma-separated models', () => {
    expect(parseModelList('glm-4.7, glm-4.7-flash')).toEqual([
      'glm-4.7',
      'glm-4.7-flash',
    ])
  })

  test('returns single model in an array', () => {
    expect(parseModelList('llama3.1:8b')).toEqual(['llama3.1:8b'])
  })

  test('trims whitespace around each model', () => {
    expect(parseModelList('  gpt-4o ,  gpt-4o-mini  , o3-mini ')).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
    ])
  })

  test('filters out empty entries from trailing commas', () => {
    expect(parseModelList('gpt-4o,,gpt-4o-mini,')).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ])
  })

  test('returns empty array for empty string', () => {
    expect(parseModelList('')).toEqual([])
  })

  test('returns empty array for whitespace-only string', () => {
    expect(parseModelList('   ')).toEqual([])
  })

  test('returns empty array for comma-only string', () => {
    expect(parseModelList(',,,')).toEqual([])
  })

  test('handles models with colons', () => {
    expect(parseModelList('qwen2.5-coder:7b, llama3.1:8b')).toEqual([
      'qwen2.5-coder:7b',
      'llama3.1:8b',
    ])
  })
})

// ── getPrimaryModel ───────────────────────────────────────────────────────────

describe('getPrimaryModel', () => {
  test('returns first model from comma-separated list', () => {
    expect(getPrimaryModel('glm-4.7, glm-4.7-flash')).toBe('glm-4.7')
  })

  test('returns the only model when single model is provided', () => {
    expect(getPrimaryModel('llama3.1:8b')).toBe('llama3.1:8b')
  })

  test('returns the original string when input is empty', () => {
    expect(getPrimaryModel('')).toBe('')
  })

  test('returns first model after trimming', () => {
    expect(getPrimaryModel('  gpt-4o , gpt-4o-mini')).toBe('gpt-4o')
  })

  test('returns first model when others are empty from trailing commas', () => {
    expect(getPrimaryModel('claude-sonnet-4-6,,')).toBe('claude-sonnet-4-6')
  })
})

// ── hasMultipleModels ─────────────────────────────────────────────────────────

describe('hasMultipleModels', () => {
  test('returns true when multiple models are present', () => {
    expect(hasMultipleModels('glm-4.7, glm-4.7-flash')).toBe(true)
  })

  test('returns false for a single model', () => {
    expect(hasMultipleModels('llama3.1:8b')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(hasMultipleModels('')).toBe(false)
  })

  test('returns false for whitespace-only string', () => {
    expect(hasMultipleModels('   ')).toBe(false)
  })

  test('returns false when extra commas produce no extra models', () => {
    expect(hasMultipleModels('gpt-4o,,')).toBe(false)
  })

  test('returns true for three models', () => {
    expect(hasMultipleModels('a, b, c')).toBe(true)
  })
})
