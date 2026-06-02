import { afterEach, expect, test } from 'bun:test'
import { getClaudeCodeUserAgent, getPublicBuildVersion } from './userAgent.js'

const originalMacro = (globalThis as Record<string, unknown>).MACRO

afterEach(() => {
  ;(globalThis as Record<string, unknown>).MACRO = originalMacro
})

test('prefers DISPLAY_VERSION for public build version strings', () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '99.0.0',
    DISPLAY_VERSION: '0.7.0',
  }

  expect(getPublicBuildVersion()).toBe('0.7.0')
  expect(getClaudeCodeUserAgent()).toBe('claude-code/99.0.0')
})

test('falls back to VERSION when DISPLAY_VERSION is unavailable', () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '0.7.0-dev',
  }

  expect(getPublicBuildVersion()).toBe('0.7.0-dev')
  expect(getClaudeCodeUserAgent()).toBe('claude-code/0.7.0-dev')
})
