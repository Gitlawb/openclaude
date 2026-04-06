import { describe, expect, test } from 'bun:test'
import {
  normalizeToolArguments,
  shouldNormalizeToolArgumentsAtStop,
} from './toolArgumentNormalization'

describe('normalizeToolArguments', () => {
  describe('Bash tool', () => {
    test('wraps plain string into { command }', () => {
      expect(normalizeToolArguments('Bash', 'pwd')).toEqual({ command: 'pwd' })
    })

    test('wraps multi-word command', () => {
      expect(normalizeToolArguments('Bash', 'ls -la /tmp')).toEqual({
        command: 'ls -la /tmp',
      })
    })

    test('passes through structured JSON object', () => {
      expect(
        normalizeToolArguments('Bash', '{"command":"echo hi"}'),
      ).toEqual({ command: 'echo hi' })
    })

    test('returns empty object for blank string', () => {
      expect(normalizeToolArguments('Bash', '')).toEqual({})
      expect(normalizeToolArguments('Bash', '   ')).toEqual({})
    })

    test('returns parsed blank for JSON-encoded blank string', () => {
      expect(normalizeToolArguments('Bash', '""')).toEqual('')
      expect(normalizeToolArguments('Bash', '"  "')).toEqual('  ')
    })

    test('returns empty object for malformed structured object literal', () => {
      expect(normalizeToolArguments('Bash', '{ "command": "pwd"')).toEqual({})
    })

    test.each([
      ['{command:"pwd"}'],
      ["{'command':'pwd'}"],
      ['{command: pwd}'],
    ])(
      'returns empty object for malformed object-shaped string %s (does not wrap into command)',
      (input) => {
        expect(normalizeToolArguments('Bash', input)).toEqual({})
      },
    )

    test.each([
      ['false', false],
      ['null', null],
      ['[]', [] as unknown[]],
      ['0', 0],
      ['true', true],
      ['123', 123],
    ])(
      'preserves JSON literal %s as-is (does not wrap into command)',
      (input, expected) => {
        expect(normalizeToolArguments('Bash', input)).toEqual(expected)
      },
    )

    test('wraps JSON-encoded string into { command }', () => {
      expect(normalizeToolArguments('Bash', '"pwd"')).toEqual({
        command: 'pwd',
      })
    })
  })

  describe('undefined arguments', () => {
    test('returns empty object for undefined', () => {
      expect(normalizeToolArguments('Bash', undefined)).toEqual({})
      expect(normalizeToolArguments('UnknownTool', undefined)).toEqual({})
    })
  })

  describe('Read tool', () => {
    test('wraps plain string into { file_path }', () => {
      expect(normalizeToolArguments('Read', '/home/user/file.txt')).toEqual({
        file_path: '/home/user/file.txt',
      })
    })

    test('wraps JSON-encoded string into { file_path }', () => {
      expect(normalizeToolArguments('Read', '"/home/user/file.txt"')).toEqual({
        file_path: '/home/user/file.txt',
      })
    })

    test('passes through structured JSON object', () => {
      expect(
        normalizeToolArguments('Read', '{"file_path":"/tmp/f.txt","limit":10}'),
      ).toEqual({ file_path: '/tmp/f.txt', limit: 10 })
    })
  })

  describe('Write tool', () => {
    test('wraps plain string into { file_path }', () => {
      expect(normalizeToolArguments('Write', '/tmp/out.txt')).toEqual({
        file_path: '/tmp/out.txt',
      })
    })

    test('passes through structured JSON object', () => {
      expect(
        normalizeToolArguments(
          'Write',
          '{"file_path":"/tmp/out.txt","content":"hello"}',
        ),
      ).toEqual({ file_path: '/tmp/out.txt', content: 'hello' })
    })
  })

  describe('Edit tool', () => {
    test('wraps plain string into { file_path }', () => {
      expect(normalizeToolArguments('Edit', '/tmp/edit.ts')).toEqual({
        file_path: '/tmp/edit.ts',
      })
    })

    test('passes through structured JSON object', () => {
      expect(
        normalizeToolArguments(
          'Edit',
          '{"file_path":"/tmp/f.ts","old_string":"a","new_string":"b"}',
        ),
      ).toEqual({ file_path: '/tmp/f.ts', old_string: 'a', new_string: 'b' })
    })
  })

  describe('Glob tool', () => {
    test('wraps plain string into { pattern }', () => {
      expect(normalizeToolArguments('Glob', '**/*.ts')).toEqual({
        pattern: '**/*.ts',
      })
    })

    test('passes through structured JSON object', () => {
      expect(
        normalizeToolArguments('Glob', '{"pattern":"*.js","path":"/src"}'),
      ).toEqual({ pattern: '*.js', path: '/src' })
    })
  })

  describe('Grep tool', () => {
    test('wraps plain string into { pattern }', () => {
      expect(normalizeToolArguments('Grep', 'TODO')).toEqual({
        pattern: 'TODO',
      })
    })

    test('passes through structured JSON object', () => {
      expect(
        normalizeToolArguments('Grep', '{"pattern":"fixme","path":"/src"}'),
      ).toEqual({ pattern: 'fixme', path: '/src' })
    })
  })

  describe('shouldNormalizeToolArgumentsAtStop', () => {
    test('returns true for Agent', () => {
      expect(shouldNormalizeToolArgumentsAtStop('Agent')).toBe(true)
    })

    test('returns true for mapped tools', () => {
      expect(shouldNormalizeToolArgumentsAtStop('Bash')).toBe(true)
      expect(shouldNormalizeToolArgumentsAtStop('Read')).toBe(true)
    })

    test('returns false for unrelated tools', () => {
      expect(shouldNormalizeToolArgumentsAtStop('UnknownTool')).toBe(false)
    })
  })

  describe('unknown tools', () => {
    test('returns empty object for plain string (no known field mapping)', () => {
      expect(normalizeToolArguments('UnknownTool', 'some value')).toEqual({})
    })

    test('passes through structured JSON object', () => {
      expect(
        normalizeToolArguments('UnknownTool', '{"key":"val"}'),
      ).toEqual({ key: 'val' })
    })

    test('preserves JSON literals as-is', () => {
      expect(normalizeToolArguments('UnknownTool', 'false')).toEqual(false)
      expect(normalizeToolArguments('UnknownTool', 'null')).toEqual(null)
      expect(normalizeToolArguments('UnknownTool', '[]')).toEqual([])
    })

    test('returns parsed string for JSON-encoded string on unknown tools', () => {
      expect(normalizeToolArguments('UnknownTool', '"hello"')).toEqual(
        'hello',
      )
    })
  })
})
