import { afterEach, expect, mock, test } from 'bun:test'

import { DEFAULT_CODEX_BASE_URL } from '../services/api/providerConfig.js'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

async function readPropertyValue(
  label: string,
  provider:
    | 'openai'
    | 'codex'
    | 'nvidia-nim'
    | 'minimax',
): Promise<unknown> {
  mock.restore()
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => true,
    isGithubNativeAnthropicMode: () => false,
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  const { buildAPIProviderProperties } = await import(`./status.js?ts=${nonce}`)
  return buildAPIProviderProperties().find(property => property.label === label)
    ?.value
}

afterEach(() => {
  mock.restore()
  restoreEnv()
})

test('buildAPIProviderProperties labels NVIDIA NIM sessions', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'

  expect(await readPropertyValue('API provider', 'nvidia-nim')).toBe('NVIDIA NIM')
  expect(await readPropertyValue('NVIDIA NIM base URL', 'nvidia-nim')).toBe(
    'https://integrate.api.nvidia.com/v1',
  )
  expect(await readPropertyValue('Model', 'nvidia-nim')).toBe(
    'nvidia/llama-3.1-nemotron-70b-instruct',
  )
})

test('buildAPIProviderProperties labels MiniMax sessions', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.MINIMAX_API_KEY = 'minimax-key'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.chat/v1'
  process.env.OPENAI_MODEL = 'MiniMax-M2.5'

  expect(await readPropertyValue('API provider', 'minimax')).toBe('MiniMax')
  expect(await readPropertyValue('MiniMax base URL', 'minimax')).toBe(
    'https://api.minimax.chat/v1',
  )
  expect(await readPropertyValue('Model', 'minimax')).toBe('MiniMax-M2.5')
})

test('buildAPIProviderProperties keeps Codex-specific labels on the shared OpenAI-compatible path', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = DEFAULT_CODEX_BASE_URL
  process.env.OPENAI_MODEL = 'codexplan'
  process.env.CHATGPT_ACCOUNT_ID = 'acct_123'

  expect(await readPropertyValue('API provider', 'codex')).toBe('Codex')
  expect(await readPropertyValue('Codex base URL', 'codex')).toBe(
    DEFAULT_CODEX_BASE_URL,
  )
  expect(await readPropertyValue('Model', 'codex')).toBe('gpt-5.5 (high)')
})
