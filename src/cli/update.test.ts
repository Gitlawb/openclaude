import { afterEach, describe, expect, test } from 'bun:test'
import { getGlobalUpdateFailureHint } from './update.js'

const originalMacro = (globalThis as Record<string, unknown>).MACRO

afterEach(() => {
  if (originalMacro === undefined) {
    delete (globalThis as Record<string, unknown>).MACRO
  } else {
    ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  }
})

describe('getGlobalUpdateFailureHint', () => {
  test('points npm-only builds at npm instead of the native installer', () => {
    ;(globalThis as Record<string, unknown>).MACRO = {
      PACKAGE_URL: '@gitlawb/openclaude',
    }

    expect(getGlobalUpdateFailureHint(false)).toContain(
      'npm install -g @gitlawb/openclaude@latest',
    )
    expect(getGlobalUpdateFailureHint(false)).not.toContain('openclaude install')
  })

  test('preserves native installer guidance for native-capable builds', () => {
    expect(getGlobalUpdateFailureHint(true)).toBe(
      'Or consider using native installation with: openclaude install\n',
    )
  })
})
