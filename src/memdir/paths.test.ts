import { afterEach, beforeEach, expect, test, mock } from 'bun:test'
import { isAutoMemoryEnabled } from './paths.ts'

// Pin issue #1326: `memory.autoWrite` is a discoverable alias for the legacy
// `autoMemoryEnabled` setting, and either key opts out for governance /
// regulated / client-sensitive repos.

let _originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  _originalEnv = {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
    CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
    CLAUDE_CODE_REMOTE: process.env.CLAUDE_CODE_REMOTE,
    CLAUDE_CODE_REMOTE_MEMORY_DIR: process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR,
  }
  delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
})

afterEach(() => {
  for (const [k, v] of Object.entries(_originalEnv)) {
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
  mock.restore()
})

function mockSettings(settings: Record<string, unknown>): void {
  mock.module('../utils/settings/settings.js', () => ({
    getInitialSettings: () => settings,
    getSettingsForSource: () => settings,
  }))
}

test('defaults to enabled when no setting and no env override', () => {
  mockSettings({})
  expect(isAutoMemoryEnabled()).toBe(true)
})

test('memory.autoWrite: false opts out via the new discoverable alias (#1326)', () => {
  mockSettings({ memory: { autoWrite: false } })
  expect(isAutoMemoryEnabled()).toBe(false)
})

test('memory.autoWrite: true explicitly opts in', () => {
  mockSettings({ memory: { autoWrite: true } })
  expect(isAutoMemoryEnabled()).toBe(true)
})

test('legacy autoMemoryEnabled: false still opts out (back-compat)', () => {
  mockSettings({ autoMemoryEnabled: false })
  expect(isAutoMemoryEnabled()).toBe(false)
})

test('legacy autoMemoryEnabled: true still opts in (back-compat)', () => {
  mockSettings({ autoMemoryEnabled: true })
  expect(isAutoMemoryEnabled()).toBe(true)
})

test('opt-out wins when one key says off and the other says on', () => {
  // Parent-scope autoMemoryEnabled: false must not be silently re-enabled by
  // a narrower memory.autoWrite: true (or vice versa).
  mockSettings({ autoMemoryEnabled: false, memory: { autoWrite: true } })
  expect(isAutoMemoryEnabled()).toBe(false)

  mockSettings({ autoMemoryEnabled: true, memory: { autoWrite: false } })
  expect(isAutoMemoryEnabled()).toBe(false)
})

test('env var still overrides settings', () => {
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  mockSettings({ memory: { autoWrite: true } })
  expect(isAutoMemoryEnabled()).toBe(false)
})
