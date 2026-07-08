import { describe, expect, it } from 'bun:test'
import {
  getSafetyLevel,
  isPermissiveSafety,
  resetSafetyLevelCache,
} from './safetyLevel.js'
import { installSafetyLevelTestCleanup } from '../../test/safetyLevelTestHelpers.js'

installSafetyLevelTestCleanup()

describe('getSafetyLevel', () => {
  it('defaults to balanced when unset', () => {
    expect(getSafetyLevel()).toBe('balanced')
    expect(isPermissiveSafety()).toBe(false)
  })

  it('parses permissive', () => {
    process.env.OPENCLAUDE_SAFETY_LEVEL = 'permissive'
    resetSafetyLevelCache()
    expect(getSafetyLevel()).toBe('permissive')
    expect(isPermissiveSafety()).toBe(true)
  })

  it('parses strict', () => {
    process.env.OPENCLAUDE_SAFETY_LEVEL = 'strict'
    resetSafetyLevelCache()
    expect(getSafetyLevel()).toBe('strict')
  })

  it('falls back to balanced for unknown values', () => {
    process.env.OPENCLAUDE_SAFETY_LEVEL = 'whatever'
    resetSafetyLevelCache()
    expect(getSafetyLevel()).toBe('balanced')
  })
})
