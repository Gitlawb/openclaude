import { describe, test, expect, afterEach, mock } from 'bun:test'
import { detectProvider } from './detect'

// Track the mock return value for getAPIProvider
let mockAPIProvider: string = 'firstParty'

mock.module('../../utils/model/providers.js', () => ({
  getAPIProvider: () => mockAPIProvider,
}))

describe('detectProvider', () => {
  const envBackup: Record<string, string | undefined> = {}

  afterEach(() => {
    // Reset mock to default
    mockAPIProvider = 'firstParty'

    // Restore env vars
    for (const key of [
      'CURSOR_TRACE_ID',
      'CURSOR_SESSION',
      'GEMINI_API_KEY',
      'GOOGLE_AI_API_KEY',
    ]) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key]
      } else {
        delete process.env[key]
      }
    }
  })

  function setEnv(key: string, value: string) {
    envBackup[key] = process.env[key]
    process.env[key] = value
  }

  function clearEnv(key: string) {
    envBackup[key] = process.env[key]
    delete process.env[key]
  }

  test('defaults to claude when no env vars are set', () => {
    clearEnv('CURSOR_TRACE_ID')
    clearEnv('CURSOR_SESSION')
    clearEnv('GEMINI_API_KEY')
    clearEnv('GOOGLE_AI_API_KEY')

    expect(detectProvider()).toBe('claude')
  })

  test('returns cursor when CURSOR_TRACE_ID is set (API provider non-mapped)', () => {
    clearEnv('CURSOR_SESSION')
    clearEnv('GEMINI_API_KEY')
    clearEnv('GOOGLE_AI_API_KEY')
    setEnv('CURSOR_TRACE_ID', 'some-trace-id')
    mockAPIProvider = 'openai'

    expect(detectProvider()).toBe('cursor')
  })

  test('returns cursor when CURSOR_SESSION is set (API provider non-mapped)', () => {
    clearEnv('CURSOR_TRACE_ID')
    clearEnv('GEMINI_API_KEY')
    clearEnv('GOOGLE_AI_API_KEY')
    setEnv('CURSOR_SESSION', 'some-session')
    mockAPIProvider = 'openai'

    expect(detectProvider()).toBe('cursor')
  })

  test('returns gemini when GEMINI_API_KEY is set (API provider non-mapped)', () => {
    clearEnv('CURSOR_TRACE_ID')
    clearEnv('CURSOR_SESSION')
    clearEnv('GOOGLE_AI_API_KEY')
    setEnv('GEMINI_API_KEY', 'key-123')
    mockAPIProvider = 'openai'

    expect(detectProvider()).toBe('gemini')
  })

  test('returns gemini when GOOGLE_AI_API_KEY is set (API provider non-mapped)', () => {
    clearEnv('CURSOR_TRACE_ID')
    clearEnv('CURSOR_SESSION')
    clearEnv('GEMINI_API_KEY')
    setEnv('GOOGLE_AI_API_KEY', 'key-456')
    mockAPIProvider = 'openai'

    expect(detectProvider()).toBe('gemini')
  })

  test('explicit provider overrides env vars', () => {
    setEnv('CURSOR_TRACE_ID', 'some-trace-id')
    setEnv('GEMINI_API_KEY', 'key-123')

    expect(detectProvider('gemini')).toBe('gemini')
    expect(detectProvider('claude')).toBe('claude')
    expect(detectProvider('cursor')).toBe('cursor')
    expect(detectProvider('generic')).toBe('generic')
  })

  test('cursor takes priority over gemini when both are set (API provider non-mapped)', () => {
    clearEnv('CURSOR_SESSION')
    setEnv('CURSOR_TRACE_ID', 'trace')
    setEnv('GEMINI_API_KEY', 'key')
    mockAPIProvider = 'openai'

    expect(detectProvider()).toBe('cursor')
  })

  test('returns claude when getAPIProvider returns firstParty', () => {
    clearEnv('CURSOR_TRACE_ID')
    clearEnv('CURSOR_SESSION')
    clearEnv('GEMINI_API_KEY')
    clearEnv('GOOGLE_AI_API_KEY')
    mockAPIProvider = 'firstParty'

    expect(detectProvider()).toBe('claude')
  })

  test('returns gemini when getAPIProvider returns gemini', () => {
    clearEnv('CURSOR_TRACE_ID')
    clearEnv('CURSOR_SESSION')
    clearEnv('GEMINI_API_KEY')
    clearEnv('GOOGLE_AI_API_KEY')
    mockAPIProvider = 'gemini'

    expect(detectProvider()).toBe('gemini')
  })

  test('falls through to env vars when getAPIProvider returns other provider', () => {
    setEnv('CURSOR_TRACE_ID', 'trace')
    clearEnv('CURSOR_SESSION')
    clearEnv('GEMINI_API_KEY')
    clearEnv('GOOGLE_AI_API_KEY')
    mockAPIProvider = 'openai'

    expect(detectProvider()).toBe('cursor')
  })
})
