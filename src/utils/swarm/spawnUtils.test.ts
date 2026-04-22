import { afterEach, beforeEach, expect, test } from 'bun:test'

import { buildInheritedEnvVars } from './spawnUtils.js'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

test('buildInheritedEnvVars marks spawned teammates as host-managed for provider routing', () => {
  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1')
})

test('buildInheritedEnvVars forwards PATH for source-built teammate tool lookups', () => {
  process.env.PATH = '/custom/bin:/usr/bin'

  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('PATH=')
  expect(envVars).toContain('/custom/bin\\:/usr/bin')
})

test('buildInheritedEnvVars forwards optional OPENAI_CUSTOM_HEADERS with shell-safe quoting', () => {
  process.env.OPENAI_CUSTOM_HEADERS = 'api-key: one;X-Org: team-a'

  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('OPENAI_CUSTOM_HEADERS=')
  expect(envVars).toContain("OPENAI_CUSTOM_HEADERS='api-key: one;X-Org: team-a'")
})
