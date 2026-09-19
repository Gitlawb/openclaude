import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_GLOBAL_CONFIG,
  GLOBAL_CONFIG_KEYS,
  isGlobalConfigKey,
} from '../../utils/config.js'

const source = readFileSync(join(import.meta.dirname, 'Config.tsx'), 'utf8')

describe('/config query idle timeout', () => {
  test('registers the persisted global preference', () => {
    expect(GLOBAL_CONFIG_KEYS).toContain('queryIdleTimeoutMs')
    expect(isGlobalConfigKey('queryIdleTimeoutMs')).toBe(true)
    expect(DEFAULT_GLOBAL_CONFIG.queryIdleTimeoutMs).toBeUndefined()
  })

  test('renders and persists the setting beside interactive query controls', () => {
    const maxTurnsIndex = source.indexOf("id: 'replMaxTurns'")
    const idleTimeoutIndex = source.indexOf("id: 'queryIdleTimeoutMs'")
    const nextSettingIndex = source.indexOf(
      "id: 'toolHistoryCompressionEnabled'",
      idleTimeoutIndex,
    )

    expect(maxTurnsIndex).toBeGreaterThan(-1)
    expect(idleTimeoutIndex).toBeGreaterThan(maxTurnsIndex)
    expect(nextSettingIndex).toBeGreaterThan(idleTimeoutIndex)
    expect(source).toContain("label: 'Query idle timeout'")
    expect(source).toContain('queryIdleTimeoutMs\n      })')
    expect(source).toContain('Set query idle timeout to')
  })
})
