import { describe, expect, it } from 'bun:test'
import {
  bashCommandIsSafeAsync_DEPRECATED,
  bashCommandIsSafe_DEPRECATED,
} from './bashSecurity.js'
import { resetSafetyLevelCache } from '../../utils/permissions/safetyLevel.js'
import { installSafetyLevelTestCleanup } from '../../test/safetyLevelTestHelpers.js'

installSafetyLevelTestCleanup()

describe('bash security check respects safety level (issue #1616)', () => {
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

  it('passes benign command substitution in the async guard under permissive mode', async () => {
    process.env.OPENCLAUDE_SAFETY_LEVEL = 'permissive'
    resetSafetyLevelCache()
    const result = await bashCommandIsSafeAsync_DEPRECATED('echo "built $(date)"')
    expect(result.behavior).toBe('passthrough')
  })
})
