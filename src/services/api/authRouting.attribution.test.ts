import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'
import { resolveCurrentAnthropicAttributionPolicy } from './authRouting.js'

const routeEnvKeys = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
  'MINIMAX_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
] as const
const originalEnv = { ...process.env }

beforeEach(async () => {
  await acquireSharedMutationLock('authRouting.attribution.test.ts')
  for (const key of routeEnvKeys) delete process.env[key]
  process.env.ANTHROPIC_API_KEY = 'sk-test-attribution-routing'
})

afterEach(() => {
  try {
    for (const key of routeEnvKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('current Anthropic attribution route resolution', () => {
  for (const [label, envKey] of [
    ['Bedrock', 'CLAUDE_CODE_USE_BEDROCK'],
    ['Vertex', 'CLAUDE_CODE_USE_VERTEX'],
    ['Foundry', 'CLAUDE_CODE_USE_FOUNDRY'],
  ] as const) {
    test(`does not emit first-party metadata on ${label}`, () => {
      process.env[envKey] = '1'

      expect(
        resolveCurrentAnthropicAttributionPolicy({
          attributionEnabled: true,
        }),
      ).toEqual({
        generate: false,
        retain: false,
        reason: 'non_official_route',
      })
    })
  }

  test('does not emit through a provider override', () => {
    expect(
      resolveCurrentAnthropicAttributionPolicy({
        attributionEnabled: true,
        providerOverride: {
          model: 'third-party-model',
          baseURL: 'https://provider.example/v1',
          apiKey: 'provider-test-key',
        },
      }),
    ).toMatchObject({ generate: false, retain: false })
  })

  test('treats a custom Anthropic Messages route as non-official', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://messages.example/v1'
    process.env.ANTHROPIC_MODEL = 'claude-compatible'

    expect(
      resolveCurrentAnthropicAttributionPolicy({
        attributionEnabled: true,
      }),
    ).toMatchObject({ generate: false, retain: false })
  })
})
