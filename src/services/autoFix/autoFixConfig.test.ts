import { describe, expect, test } from 'bun:test'
import { AutoFixConfigSchema, getAutoFixConfig, type AutoFixConfig } from './autoFixConfig.js'

describe('AutoFixConfigSchema', () => {
  test('parses valid full config', () => {
    const input = {
      enabled: true,
      lint: 'eslint . --fix',
      test: 'bun test',
      maxRetries: 3,
      timeout: 30000,
    }
    const result = AutoFixConfigSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)
      expect(result.data.lint).toBe('eslint . --fix')
      expect(result.data.test).toBe('bun test')
      expect(result.data.maxRetries).toBe(3)
      expect(result.data.timeout).toBe(30000)
    }
  })

  test('parses minimal config with defaults', () => {
    const input = { enabled: true, lint: 'eslint .' }
    const result = AutoFixConfigSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.maxRetries).toBe(3)
      expect(result.data.timeout).toBe(30000)
      expect(result.data.test).toBeUndefined()
    }
  })

  test('rejects config with enabled but no lint or test', () => {
    const input = { enabled: true }
    const result = AutoFixConfigSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  test('accepts disabled config without commands', () => {
    const input = { enabled: false }
    const result = AutoFixConfigSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  test('rejects negative maxRetries', () => {
    const input = { enabled: true, lint: 'eslint .', maxRetries: -1 }
    const result = AutoFixConfigSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  test('rejects maxRetries above 10', () => {
    const input = { enabled: true, lint: 'eslint .', maxRetries: 11 }
    const result = AutoFixConfigSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('getAutoFixConfig', () => {
  test('returns null when settings have no autoFix', () => {
    const result = getAutoFixConfig(undefined)
    expect(result).toBeNull()
  })

  test('returns null when autoFix is disabled', () => {
    const result = getAutoFixConfig({ enabled: false })
    expect(result).toBeNull()
  })

  test('returns parsed config when valid and enabled', () => {
    const result = getAutoFixConfig({ enabled: true, lint: 'eslint .' })
    expect(result).not.toBeNull()
    expect(result!.enabled).toBe(true)
    expect(result!.lint).toBe('eslint .')
  })
})
