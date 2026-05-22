import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../test/sharedMutationLock.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_GEMINI',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
]

const originalEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/messages.test.ts')
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  try {
    mock.restore()
    for (const key of ENV_KEYS) {
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

async function importMessagesWithProvider(provider: string) {
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => provider,
    usesAnthropicAccountFlow: () => provider === 'firstParty',
    getAPIProviderForStatsig: () => provider,
    isGithubNativeAnthropicMode: () => false,
    isFirstPartyAnthropicBaseUrl: () => provider === 'firstParty',
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./messages.ts?ts=${nonce}`)
}

function assistantWithGeminiToolMetadata() {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Read',
          input: { file_path: '/tmp/example.txt' },
          extra_content: {
            google: {
              thought_signature: 'sig-from-gemini',
            },
          },
          signature: 'sig-from-gemini',
          caller: 'gemini-tool-search',
        },
      ],
    },
  }
}

test('normalizeMessagesForAPI strips Gemini tool metadata for non-Gemini providers', async () => {
  const { normalizeMessagesForAPI } = await importMessagesWithProvider('anthropic')

  const [normalized] = normalizeMessagesForAPI([
    assistantWithGeminiToolMetadata(),
  ])
  const [toolUse] = normalized.message.content

  expect(toolUse).toEqual({
    type: 'tool_use',
    id: 'toolu_1',
    name: 'Read',
    input: { file_path: '/tmp/example.txt' },
  })
})

test('stripCallerFieldFromAssistantMessage strips Gemini tool metadata for non-Gemini providers', async () => {
  const { stripCallerFieldFromAssistantMessage } = await importMessagesWithProvider('anthropic')

  const stripped = stripCallerFieldFromAssistantMessage(
    assistantWithGeminiToolMetadata(),
  )
  const [toolUse] = stripped.message.content

  expect(toolUse).toEqual({
    type: 'tool_use',
    id: 'toolu_1',
    name: 'Read',
    input: { file_path: '/tmp/example.txt' },
  })
})

test('normalizeMessagesForAPI preserves Gemini tool metadata in Gemini mode', async () => {
  const { normalizeMessagesForAPI } = await importMessagesWithProvider('gemini')

  const [normalized] = normalizeMessagesForAPI([
    assistantWithGeminiToolMetadata(),
  ])
  const [toolUse] = normalized.message.content

  expect(toolUse).toMatchObject({
    extra_content: {
      google: {
        thought_signature: 'sig-from-gemini',
      },
    },
    signature: 'sig-from-gemini',
  })
})
