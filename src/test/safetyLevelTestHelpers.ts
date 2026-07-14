import { afterEach } from 'bun:test'

import { resetSafetyLevelCache } from '../utils/permissions/safetyLevel.js'

export function resetSafetyLevelForTest(): void {
  delete process.env.OPENCLAUDE_SAFETY_LEVEL
  resetSafetyLevelCache()
}

export function installSafetyLevelTestCleanup(): void {
  afterEach(() => {
    resetSafetyLevelForTest()
  })
}
