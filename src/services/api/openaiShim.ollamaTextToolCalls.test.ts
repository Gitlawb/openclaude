/**
 * Unit tests for parseTextToolCalls — the Ollama text-based tool call
 * fallback parser introduced in fix/#1053.
 *
 * Covers the four formats requested in the PR review:
 *   1. Bare JSON object  {"name":"X","arguments":{}}
 *   2. Fenced ```json``` block
 *   3. {type:"function",function:{name,arguments}} shape
 *   4. Deduplication by name:args key
 */
import { describe, expect, test } from 'bun:test'
import { parseTextToolCalls } from './openaiShim.js'

describe('parseTextToolCalls', () => {
  test('parses bare JSON object {"name","arguments"} shape', () => {
    const text = `Let me read that file.\n{"name":"Read","arguments":{"file_path":"/tmp/foo.ts"}}`
    const calls = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Read')
    expect(calls[0].arguments).toEqual({ file_path: '/tmp/foo.ts' })
    expect(calls[0].id).toMatch(/^ollama_tc_\d+$/)
  })

  test('parses fenced ```json``` block', () => {
    const text = 'I will run this:\n```json\n{"name":"Bash","arguments":{"command":"ls -la"}}\n```'
    const calls = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].arguments).toEqual({ command: 'ls -la' })
  })

  test('parses fenced ``` block (no language tag)', () => {
    const text = '```\n{"name":"Glob","arguments":{"pattern":"src/**/*.ts"}}\n```'
    const calls = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Glob')
  })

  test('parses {type:"function",function:{name,arguments}} shape', () => {
    const text = '{"type":"function","function":{"name":"Grep","arguments":{"pattern":"TODO","path":"src"}}}'
    const calls = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Grep')
    expect(calls[0].arguments).toEqual({ pattern: 'TODO', path: 'src' })
  })

  test('parses {type:"function"} shape when arguments is a JSON string', () => {
    const args = JSON.stringify({ file_path: '/tmp/x.ts' })
    const text = `{"type":"function","function":{"name":"Read","arguments":${JSON.stringify(args)}}}`
    const calls = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Read')
    expect(calls[0].arguments).toEqual({ file_path: '/tmp/x.ts' })
  })

  test('deduplicates by name:args key', () => {
    const snippet = '{"name":"Read","arguments":{"file_path":"/tmp/foo.ts"}}'
    const text = `${snippet}\nSome text\n${snippet}`
    const calls = parseTextToolCalls(text)
    expect(calls).toHaveLength(1)
  })

  test('returns multiple distinct calls', () => {
    const text = [
      '{"name":"Read","arguments":{"file_path":"a.ts"}}',
      '{"name":"Bash","arguments":{"command":"echo hi"}}',
    ].join('\n')
    const calls = parseTextToolCalls(text)
    expect(calls).toHaveLength(2)
    expect(calls.map(c => c.name)).toEqual(['Read', 'Bash'])
  })

  test('returns empty array for plain text with no JSON', () => {
    const calls = parseTextToolCalls('I think you should check the file manually.')
    expect(calls).toHaveLength(0)
  })

  test('ignores malformed JSON', () => {
    const calls = parseTextToolCalls('{"name":"Read","arguments":{broken}')
    expect(calls).toHaveLength(0)
  })

  test('ignores JSON objects without name or type:function', () => {
    const calls = parseTextToolCalls('{"foo":"bar","baz":42}')
    expect(calls).toHaveLength(0)
  })
})
