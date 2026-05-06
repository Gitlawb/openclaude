import { afterEach, expect, test } from 'bun:test'
import { getProviderApiUserAgent, getUserAgent } from './http.js'

const originalMacro = (globalThis as Record<string, unknown>).MACRO
const compatibilityVersion = '99.0.0'
const publicBuildVersion = '1.2.3-open'
const originalEnv = {
  USER_TYPE: process.env.USER_TYPE,
  CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
}

afterEach(() => {
  ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  if (originalEnv.USER_TYPE === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalEnv.USER_TYPE
  }
  if (originalEnv.CLAUDE_CODE_ENTRYPOINT === undefined) {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  } else {
    process.env.CLAUDE_CODE_ENTRYPOINT = originalEnv.CLAUDE_CODE_ENTRYPOINT
  }
  if (originalEnv.CLAUDE_CODE_USE_OPENAI === undefined) {
    delete process.env.CLAUDE_CODE_USE_OPENAI
  } else {
    process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  }
})

test('uses claude-cli token for first-party API compatibility', () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: compatibilityVersion,
    DISPLAY_VERSION: publicBuildVersion,
  }
  process.env.USER_TYPE = 'test-user'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'

  expect(getUserAgent()).toContain(`claude-cli/${compatibilityVersion}`)
  expect(getUserAgent()).not.toContain(`claude-cli/${publicBuildVersion}`)
})

test('uses claude-cli token for anthropic-owned endpoints even with third-party provider', () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: compatibilityVersion,
    DISPLAY_VERSION: publicBuildVersion,
  }
  process.env.USER_TYPE = 'test-user'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'

  expect(getUserAgent()).toContain(`claude-cli/${compatibilityVersion}`)
  expect(getUserAgent()).not.toContain(`claude-cli/${publicBuildVersion}`)
})

test('uses openclaude-cli token for non-first-party provider API traffic', () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: compatibilityVersion,
    DISPLAY_VERSION: publicBuildVersion,
  }
  process.env.USER_TYPE = 'test-user'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'

  expect(getProviderApiUserAgent()).toContain(
    `openclaude-cli/${publicBuildVersion}`,
  )
  expect(getProviderApiUserAgent()).not.toContain(
    `openclaude-cli/${compatibilityVersion}`,
  )
})

test('uses explicit first-party override for provider-routed api traffic', () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: compatibilityVersion,
    DISPLAY_VERSION: publicBuildVersion,
  }
  process.env.USER_TYPE = 'test-user'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'

  expect(getProviderApiUserAgent({ isFirstParty: true })).toContain(
    `claude-cli/${compatibilityVersion}`,
  )
  expect(getProviderApiUserAgent({ isFirstParty: true })).not.toContain(
    `claude-cli/${publicBuildVersion}`,
  )
})
