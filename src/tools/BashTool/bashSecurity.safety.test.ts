import { afterEach, describe, expect, it } from 'bun:test'
import { bashCommandIsSafe_DEPRECATED } from './bashSecurity.js'
import { resetSafetyLevelCache } from '../../utils/permissions/safetyLevel.js'

describe('bash security check respects safety level (issue #1616)', () => {
  afterEach(() => {
    delete process.env.OPENCLAUDE_SAFETY_LEVEL
    resetSafetyLevelCache()
  })

  it('flags benign command substitution under default (balanced) mode', () => {
    const result = bashCommandIsSafe_DEPRECATED('echo "built $(date)"')
    expect(result.behavior).toBe('ask')
  })

  it('passes benign command substitution under permissive mode', () => {
    process.env.OPENCLAUDE_SAFETY_LEVEL = 'permissive'
    resetSafetyLevelCache()
    const result = bashCommandIsSafe_DEPRECATED('echo "built $(date)"')
    expect(result.behavior).toBe('passthrough')
  })
})
