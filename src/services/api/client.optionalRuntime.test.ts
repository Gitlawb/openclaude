import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import * as optionalRuntimeModule from '../../utils/optionalRuntimeModule.js'

const originalEnv = { ...process.env }

type OptionalImport = typeof optionalRuntimeModule.importOptionalRuntimeModule

function friendlyMissing(specifier: string, feature: string): Error {
  return new Error(
    `${feature} requires the "${specifier}" package, which is not installed. ` +
      `Install it with \`npm install ${specifier}\` (add \`-g\` if you installed the CLI globally) to enable it.`,
  )
}

async function importFreshClient(importOptionalRuntimeModule: OptionalImport) {
  const client = await import(
    `./client.js?optional-runtime=${Date.now()}-${Math.random()}`
  )
  client._setOptionalRuntimeModuleImporterForTesting(importOptionalRuntimeModule)
  return client
}

beforeEach(async () => {
  await acquireSharedMutationLock('services/api/client.optionalRuntime.test.ts')
  process.env = { ...originalEnv }
  ;(globalThis as Record<string, unknown>).MACRO = { VERSION: 'test-version' }
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_FOUNDRY_API_KEY
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    delete (globalThis as Record<string, unknown>).MACRO
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('Bedrock reports the missing provider SDK through the optional runtime helper', async () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'

  const importOptionalRuntimeModule = mock(async (specifier: string, feature: string) => {
    throw friendlyMissing(specifier, feature)
  }) as unknown as OptionalImport

  const { getAnthropicClient } = await importFreshClient(importOptionalRuntimeModule)

  await expect(
    getAnthropicClient({ maxRetries: 0, model: 'claude-sonnet-4-6' }),
  ).rejects.toThrow(/AWS Bedrock requires the "@anthropic-ai\/bedrock-sdk" package/)
  expect(importOptionalRuntimeModule).toHaveBeenCalledWith(
    '@anthropic-ai/bedrock-sdk',
    'AWS Bedrock',
  )
})

test('Foundry skip-auth does not load Azure identity', async () => {
  process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
  process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH = '1'

  const importOptionalRuntimeModule = mock(async (specifier: string, feature: string) => {
    if (specifier === '@azure/identity') {
      throw friendlyMissing(specifier, feature)
    }
    if (specifier === '@anthropic-ai/foundry-sdk') {
      return {
        AnthropicFoundry: class AnthropicFoundry {
          constructor(readonly args: unknown) {}
        },
      }
    }
    throw new Error(`unexpected optional import: ${specifier}`)
  }) as unknown as OptionalImport

  const { getAnthropicClient } = await importFreshClient(importOptionalRuntimeModule)

  await getAnthropicClient({ maxRetries: 0, model: 'claude-sonnet-4-6' })

  expect(importOptionalRuntimeModule).toHaveBeenCalledWith(
    '@anthropic-ai/foundry-sdk',
    'Azure Foundry',
  )
  expect(importOptionalRuntimeModule).not.toHaveBeenCalledWith(
    '@azure/identity',
    'Azure Foundry authentication',
  )
})

test('Foundry real-auth branch reports missing Azure identity through the optional runtime helper', async () => {
  process.env.CLAUDE_CODE_USE_FOUNDRY = '1'

  const importOptionalRuntimeModule = mock(async (specifier: string, feature: string) => {
    if (specifier === '@anthropic-ai/foundry-sdk') {
      return {
        AnthropicFoundry: class AnthropicFoundry {
          constructor(readonly args: unknown) {}
        },
      }
    }
    throw friendlyMissing(specifier, feature)
  }) as unknown as OptionalImport

  const { getAnthropicClient } = await importFreshClient(importOptionalRuntimeModule)

  await expect(
    getAnthropicClient({ maxRetries: 0, model: 'claude-sonnet-4-6' }),
  ).rejects.toThrow(/Azure Foundry authentication requires the "@azure\/identity" package/)
  expect(importOptionalRuntimeModule).toHaveBeenCalledWith(
    '@azure/identity',
    'Azure Foundry authentication',
  )
})

test('Vertex skip-auth branch does not load google-auth-library', async () => {
  process.env.CLAUDE_CODE_USE_VERTEX = '1'
  process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH = '1'

  const importOptionalRuntimeModule = mock(async (specifier: string, feature: string) => {
    throw friendlyMissing(specifier, feature)
  }) as unknown as OptionalImport

  const { getAnthropicClient } = await importFreshClient(importOptionalRuntimeModule)

  await getAnthropicClient({ maxRetries: 0, model: 'claude-sonnet-4-6' })

  expect(importOptionalRuntimeModule).not.toHaveBeenCalledWith(
    'google-auth-library',
    'Vertex AI (GCP) authentication',
  )
})
