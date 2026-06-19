import { afterEach, describe, expect, test } from 'bun:test'
import { validateEnvVars } from './envValidation.js'

const optionalEnvVars = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENCLAUDE_CONFIG_DIR',
  'CLAUDE_CONFIG_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const

const originalEnv = Object.fromEntries(
  optionalEnvVars.map(name => [name, process.env[name]]),
)

function restoreEnv(): void {
  for (const name of optionalEnvVars) {
    const value = originalEnv[name]
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
}

afterEach(() => {
  restoreEnv()
})

describe('validateEnvVars', () => {
  test('treats empty optional env vars as unset', () => {
    for (const name of optionalEnvVars) {
      process.env[name] = ''
    }

    const env = validateEnvVars()

    for (const name of optionalEnvVars) {
      expect(env[name]).toBeUndefined()
    }
  })
})
