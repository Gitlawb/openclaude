import { describe, expect, test } from 'bun:test'

import { sanitizeSchemaForOpenAICompat } from './schemaSanitizer'

describe('sanitizeSchemaForOpenAICompat', () => {
  test('preserves Grep-like properties.pattern while keeping it required', () => {
    const schema = {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The regular expression pattern to search for in file contents',
        },
        path: { type: 'string' },
        glob: { type: 'string' },
      },
      required: ['pattern'],
    }

    const sanitized = sanitizeSchemaForOpenAICompat(schema)
    const properties = sanitized.properties as Record<string, unknown> | undefined

    expect(Object.keys(properties ?? {})).toEqual(['pattern', 'path', 'glob'])
    expect(properties?.pattern).toEqual({
      type: 'string',
      description: 'The regular expression pattern to search for in file contents',
    })
    expect(sanitized.required).toEqual(['pattern'])
  })

  test('preserves Glob-like properties.pattern while keeping it required', () => {
    const schema = {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The glob pattern to match files against',
        },
        path: { type: 'string' },
      },
      required: ['pattern'],
    }

    const sanitized = sanitizeSchemaForOpenAICompat(schema)
    const properties = sanitized.properties as Record<string, unknown> | undefined

    expect(Object.keys(properties ?? {})).toEqual(['pattern', 'path'])
    expect(properties?.pattern).toEqual({
      type: 'string',
      description: 'The glob pattern to match files against',
    })
    expect(sanitized.required).toEqual(['pattern'])
  })

  test('strips JSON Schema validator pattern from string schemas', () => {
    const schema = {
      type: 'string',
      pattern: '^[a-z]+$',
      minLength: 1,
    }

    const sanitized = sanitizeSchemaForOpenAICompat(schema)

    expect(sanitized).toEqual({
      type: 'string',
    })
  })

  test('strips numeric bounds rejected by strict OpenAI-compatible routers', () => {
    const schema = {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          minimum: 1,
          exclusiveMinimum: 0,
          maximum: 10,
          exclusiveMaximum: 11,
        },
      },
      required: ['count'],
    }

    const sanitized = sanitizeSchemaForOpenAICompat(schema)
    const properties = sanitized.properties as Record<string, Record<string, unknown>>

    expect(properties.count).toEqual({ type: 'integer' })
    expect(sanitized.required).toEqual(['count'])
  })

  test('strips schema combinators rejected by OpenAI-compatible tool schemas', () => {
    const sanitized = sanitizeSchemaForOpenAICompat({
      type: 'object',
      properties: {
        tags: {
          oneOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'string' },
          ],
        },
      },
    })

    const properties = sanitized.properties as Record<string, Record<string, unknown>>
    expect(properties.tags).toEqual({ type: 'string' })
    expect('oneOf' in properties.tags).toBe(false)
  })

  test('adds empty properties to object schemas without declared properties', () => {
    const sanitized = sanitizeSchemaForOpenAICompat({ type: 'object' })

    expect(sanitized).toEqual({
      type: 'object',
      properties: {},
    })
  })

  test('infers missing property types for strict provider compatibility', () => {
    const sanitized = sanitizeSchemaForOpenAICompat({
      type: 'object',
      properties: {
        start_date: {
          description: 'Optional ISO date',
        },
        labels: {
          items: { type: 'string' },
        },
      },
    })

    const properties = sanitized.properties as Record<string, Record<string, unknown>>
    expect(properties.start_date).toEqual({
      description: 'Optional ISO date',
      type: 'string',
    })
    expect(properties.labels).toEqual({
      items: { type: 'string' },
      type: 'array',
    })
  })
})
