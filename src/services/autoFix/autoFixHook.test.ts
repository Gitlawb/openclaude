import { describe, expect, test } from 'bun:test'
import {
  shouldRunAutoFix,
  buildAutoFixContext,
} from './autoFixHook.js'

describe('shouldRunAutoFix', () => {
  test('returns true for file_edit tool when autoFix enabled', () => {
    const config = { enabled: true, lint: 'eslint .', maxRetries: 3, timeout: 30000 }
    expect(shouldRunAutoFix('file_edit', config)).toBe(true)
  })

  test('returns true for file_write tool when autoFix enabled', () => {
    const config = { enabled: true, lint: 'eslint .', maxRetries: 3, timeout: 30000 }
    expect(shouldRunAutoFix('file_write', config)).toBe(true)
  })

  test('returns false for bash tool', () => {
    const config = { enabled: true, lint: 'eslint .', maxRetries: 3, timeout: 30000 }
    expect(shouldRunAutoFix('bash', config)).toBe(false)
  })

  test('returns false for file_read tool', () => {
    const config = { enabled: true, lint: 'eslint .', maxRetries: 3, timeout: 30000 }
    expect(shouldRunAutoFix('file_read', config)).toBe(false)
  })

  test('returns false when config is null', () => {
    expect(shouldRunAutoFix('file_edit', null)).toBe(false)
  })
})

describe('buildAutoFixContext', () => {
  test('formats lint errors as AI-readable context', () => {
    const context = buildAutoFixContext({
      hasErrors: true,
      lintOutput: 'src/foo.ts:10:5 error no-unused-vars',
      lintExitCode: 1,
      errorSummary: 'Lint errors (exit code 1):\nsrc/foo.ts:10:5 error no-unused-vars',
    })
    expect(context).toContain('AUTO-FIX')
    expect(context).toContain('no-unused-vars')
    expect(context).toContain('Please fix')
  })

  test('returns null when no errors', () => {
    const context = buildAutoFixContext({
      hasErrors: false,
    })
    expect(context).toBeNull()
  })

  test('formats test failures as AI-readable context', () => {
    const context = buildAutoFixContext({
      hasErrors: true,
      testOutput: 'FAIL src/foo.test.ts\n  expected true, got false',
      testExitCode: 1,
      errorSummary: 'Test failures (exit code 1):\nFAIL src/foo.test.ts',
    })
    expect(context).toContain('AUTO-FIX')
    expect(context).toContain('FAIL')
  })
})
