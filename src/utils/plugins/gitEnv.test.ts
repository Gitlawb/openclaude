import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  __resetGitEnvWarningForTesting,
  buildGitChildEnv,
  sanitizeEnvForGit,
} from './gitEnv.js'

describe('sanitizeEnvForGit', () => {
  test('drops values containing LF', () => {
    const result = sanitizeEnvForGit({
      GOOD: 'value',
      BAD_NEWLINE: 'line1\nline2',
    })
    expect(result.env).toEqual({ GOOD: 'value' })
    expect(result.dropped).toEqual(['BAD_NEWLINE'])
  })

  test('drops values containing CR', () => {
    const result = sanitizeEnvForGit({
      GOOD: 'value',
      BAD_CR: 'value\r',
    })
    expect(result.dropped).toEqual(['BAD_CR'])
  })

  test('drops values containing NUL', () => {
    const result = sanitizeEnvForGit({
      GOOD: 'value',
      BAD_NUL: 'a\0b',
    })
    expect(result.dropped).toEqual(['BAD_NUL'])
  })

  test('drops keys whose name itself contains a control character', () => {
    const result = sanitizeEnvForGit({
      'BAD\nKEY': 'safe-value',
      GOOD: 'value',
    })
    expect(result.env).toEqual({ GOOD: 'value' })
    expect(result.dropped).toEqual(['BAD\nKEY'])
  })

  test('skips entries explicitly set to undefined without listing them as dropped', () => {
    const result = sanitizeEnvForGit({
      GOOD: 'value',
      MAYBE: undefined,
    })
    expect(result.env).toEqual({ GOOD: 'value' })
    expect(result.dropped).toEqual([])
  })

  test('returns input unchanged when nothing is unsafe', () => {
    const env = { PATH: '/usr/bin:/bin', HOME: '/home/user', GIT_TERMINAL_PROMPT: '0' }
    const result = sanitizeEnvForGit(env)
    expect(result.env).toEqual(env)
    expect(result.dropped).toEqual([])
  })
})

describe('buildGitChildEnv', () => {
  const ORIGINAL_BAD_KEY = 'OPENCLAUDE_TEST_BAD_ENV_FOR_GIT'
  let originalValue: string | undefined

  beforeEach(() => {
    __resetGitEnvWarningForTesting()
    originalValue = process.env[ORIGINAL_BAD_KEY]
  })

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ORIGINAL_BAD_KEY]
    } else {
      process.env[ORIGINAL_BAD_KEY] = originalValue
    }
  })

  test('always sets the no-prompt overrides', () => {
    const env = buildGitChildEnv()
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_ASKPASS).toBe('')
  })

  test('drops process.env values containing control characters (issue #751)', () => {
    process.env[ORIGINAL_BAD_KEY] = 'paste-with-newline\n'
    const env = buildGitChildEnv()
    expect(env[ORIGINAL_BAD_KEY]).toBeUndefined()
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  test('caller extras override process.env and the no-prompt defaults', () => {
    const env = buildGitChildEnv({
      GIT_TERMINAL_PROMPT: '1',
      CUSTOM_KEY: 'custom-value',
    })
    expect(env.GIT_TERMINAL_PROMPT).toBe('1')
    expect(env.CUSTOM_KEY).toBe('custom-value')
  })

  test('caller-provided unsafe extras are also dropped', () => {
    const env = buildGitChildEnv({ EXTRA_BAD: 'a\rb' })
    expect(env.EXTRA_BAD).toBeUndefined()
  })
})
