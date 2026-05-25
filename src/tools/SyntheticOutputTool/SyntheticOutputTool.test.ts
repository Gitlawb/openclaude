import { describe, expect, test } from 'bun:test'
import { createSyntheticOutputTool } from './SyntheticOutputTool.js'

// Regression for #1256 — `--json-schema` failed when the user passed a
// top-level array (or any non-object root) because the Anthropic tool_use
// block requires the `input` field to be a JSON object. The tool now wraps
// non-object roots as `{result: <orig>}` and unwraps before emitting
// structured_output, so the CLI returns the exact shape the caller asked for.

const ARRAY_OF_OBJECTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
} as const

const STRING_ROOT_SCHEMA = { type: 'string' } as const

const OBJECT_SCHEMA = {
  type: 'object',
  properties: { count: { type: 'integer' } },
  required: ['count'],
  additionalProperties: false,
} as const

describe('createSyntheticOutputTool (#1256 root schema wrapping)', () => {
  test('top-level array root: wraps inputJSONSchema as object envelope', () => {
    const result = createSyntheticOutputTool({ ...ARRAY_OF_OBJECTS_SCHEMA })
    if (!('tool' in result)) throw new Error(`expected tool: ${result.error}`)
    const schema = result.tool.inputJSONSchema as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect((schema.properties as Record<string, unknown>).result).toEqual(
      ARRAY_OF_OBJECTS_SCHEMA,
    )
    expect(schema.required).toEqual(['result'])
  })

  test('top-level array root: structured_output unwraps to plain array', async () => {
    const result = createSyntheticOutputTool({ ...ARRAY_OF_OBJECTS_SCHEMA })
    if (!('tool' in result)) throw new Error(`expected tool: ${result.error}`)

    const payload = [{ name: 'one' }, { name: 'two' }]
    const callResult = await result.tool.call(
      { result: payload },
      undefined as never,
    )
    expect(callResult.structured_output).toEqual(payload)
  })

  test('top-level string root: same wrap-and-unwrap behaviour', async () => {
    const result = createSyntheticOutputTool({ ...STRING_ROOT_SCHEMA })
    if (!('tool' in result)) throw new Error(`expected tool: ${result.error}`)
    const schema = result.tool.inputJSONSchema as Record<string, unknown>
    expect(schema.type).toBe('object')

    const callResult = await result.tool.call(
      { result: 'hello' },
      undefined as never,
    )
    expect(callResult.structured_output).toBe('hello')
  })

  test('object root: passes through untouched', async () => {
    const result = createSyntheticOutputTool({ ...OBJECT_SCHEMA })
    if (!('tool' in result)) throw new Error(`expected tool: ${result.error}`)
    expect(result.tool.inputJSONSchema).toEqual(OBJECT_SCHEMA)

    const callResult = await result.tool.call(
      { count: 5 },
      undefined as never,
    )
    expect(callResult.structured_output).toEqual({ count: 5 })
  })

  test('wrapped tool rejects payloads that violate the inner schema', async () => {
    const result = createSyntheticOutputTool({ ...ARRAY_OF_OBJECTS_SCHEMA })
    if (!('tool' in result)) throw new Error(`expected tool: ${result.error}`)
    await expect(
      result.tool.call({ result: [{ wrong: 'shape' }] }, undefined as never),
    ).rejects.toThrow(/schema/)
  })
})
