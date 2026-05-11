import { describe, test, expect, beforeEach } from 'bun:test'
import {
  getToolSchemaCache,
  clearToolSchemaCache,
  invalidateRemovedToolSchemas,
} from '../../src/utils/toolSchemaCache.js'

describe('invalidateRemovedToolSchemas', () => {
  beforeEach(() => {
    clearToolSchemaCache()
  })

  test('removes entries for tools not in retained set', () => {
    const cache = getToolSchemaCache()
    // Simulate cached tool schemas with different key formats
    cache.set('Read', { name: 'Read', description: 'Read file', input_schema: {} })
    cache.set('Write', { name: 'Write', description: 'Write file', input_schema: {} })
    cache.set('Bash', { name: 'Bash', description: 'Run command', input_schema: {} })
    cache.set('Bash:{\"type\":\"object\"}', {
      name: 'Bash',
      description: 'Run command with schema',
      input_schema: { type: 'object' },
    })

    // Keep Read and Bash, remove Write
    invalidateRemovedToolSchemas(new Set(['Read', 'Bash']))

    expect(cache.has('Read')).toBe(true)
    expect(cache.has('Bash')).toBe(true)
    expect(cache.has('Bash:{\"type\":\"object\"}')).toBe(true) // Schema variant preserved
    expect(cache.has('Write')).toBe(false)
  })

  test('preserves schema variants for retained tools', () => {
    const cache = getToolSchemaCache()
    cache.set('Tool', { name: 'Tool', description: 'Basic', input_schema: {} })
    cache.set('Tool:{\"type\":\"object\",\"properties\":{}}', {
      name: 'Tool',
      description: 'With schema',
      input_schema: { type: 'object', properties: {} },
    })
    cache.set('Tool:{\"type\":\"array\"}', {
      name: 'Tool',
      description: 'Array schema',
      input_schema: { type: 'array' },
    })

    invalidateRemovedToolSchemas(new Set(['Tool']))

    // All Tool variants should be preserved
    expect(cache.size).toBe(3)
    expect(cache.has('Tool')).toBe(true)
    expect(cache.has('Tool:{\"type\":\"object\",\"properties\":{}}')).toBe(true)
    expect(cache.has('Tool:{\"type\":\"array\"}')).toBe(true)
  })

  test('handles empty retained set (clears all)', () => {
    const cache = getToolSchemaCache()
    cache.set('A', { name: 'A', description: 'Tool A', input_schema: {} })
    cache.set('B', { name: 'B', description: 'Tool B', input_schema: {} })

    invalidateRemovedToolSchemas(new Set())

    expect(cache.size).toBe(0)
  })

  test('handles empty cache gracefully', () => {
    clearToolSchemaCache()
    invalidateRemovedToolSchemas(new Set(['Read', 'Write']))
    expect(getToolSchemaCache().size).toBe(0)
  })

  test('no-op when all tools are retained', () => {
    const cache = getToolSchemaCache()
    cache.set('A', { name: 'A', description: 'Tool A', input_schema: {} })
    cache.set('B', { name: 'B', description: 'Tool B', input_schema: {} })

    invalidateRemovedToolSchemas(new Set(['A', 'B']))

    expect(cache.size).toBe(2)
    expect(cache.get('A')?.description).toBe('Tool A')
    expect(cache.get('B')?.description).toBe('Tool B')
  })
})