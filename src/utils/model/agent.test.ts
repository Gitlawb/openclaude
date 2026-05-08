import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import * as actualProviders from './providers.js'

async function importFreshAgentModule() {
  return import(`./agent.js?ts=${Date.now()}-${Math.random()}`)
}

const SAVED_ENV = {
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  MISTRAL_MODEL: process.env.MISTRAL_MODEL,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  XAI_API_KEY: process.env.XAI_API_KEY,
}

function restoreEnv(key: keyof typeof SAVED_ENV): void {
  const value = SAVED_ENV[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function clearProviderEnv(): void {
  for (const key of Object.keys(SAVED_ENV) as Array<keyof typeof SAVED_ENV>) {
    delete process.env[key]
  }
}

beforeEach(() => {
  mock.restore()
  clearProviderEnv()
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  mock.restore()
  clearProviderEnv()
  for (const key of Object.keys(SAVED_ENV) as Array<keyof typeof SAVED_ENV>) {
    restoreEnv(key)
  }
  resetModelStringsForTestingOnly()
})

function useProvider(
  provider:
    | 'anthropic'
    | 'bedrock'
    | 'vertex'
    | 'foundry'
    | 'openai'
    | 'gemini'
    | 'custom-anthropic'
    | 'mistral'
    | 'github'
    | 'nvidia-nim'
    | 'minimax'
    | 'codex',
): void {
  clearProviderEnv()
  let legacyProvider:
    | 'firstParty'
    | 'bedrock'
    | 'vertex'
    | 'foundry'
    | 'openai'
    | 'gemini'
    | 'mistral'
    | 'github'
    | 'nvidia-nim'
    | 'minimax'
    | 'codex' = 'firstParty'
  let firstPartyAnthropicBaseUrl = true

  switch (provider) {
    case 'anthropic':
      break
    case 'bedrock':
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      legacyProvider = 'bedrock'
      firstPartyAnthropicBaseUrl = false
      break
    case 'vertex':
      process.env.CLAUDE_CODE_USE_VERTEX = '1'
      legacyProvider = 'vertex'
      firstPartyAnthropicBaseUrl = false
      break
    case 'foundry':
      process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
      legacyProvider = 'foundry'
      firstPartyAnthropicBaseUrl = false
      break
    case 'openai':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
      legacyProvider = 'openai'
      firstPartyAnthropicBaseUrl = false
      break
    case 'gemini':
      process.env.CLAUDE_CODE_USE_GEMINI = '1'
      legacyProvider = 'gemini'
      firstPartyAnthropicBaseUrl = false
      break
    case 'custom-anthropic':
      process.env.ANTHROPIC_BASE_URL = 'https://anthropic-proxy.example.com'
      firstPartyAnthropicBaseUrl = false
      break
    case 'mistral':
      process.env.CLAUDE_CODE_USE_MISTRAL = '1'
      legacyProvider = 'mistral'
      firstPartyAnthropicBaseUrl = false
      break
    case 'github':
      process.env.CLAUDE_CODE_USE_GITHUB = '1'
      legacyProvider = 'github'
      firstPartyAnthropicBaseUrl = false
      break
    case 'nvidia-nim':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.NVIDIA_NIM = '1'
      legacyProvider = 'nvidia-nim'
      firstPartyAnthropicBaseUrl = false
      break
    case 'minimax':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL = 'https://api.minimax.io/v1'
      process.env.MINIMAX_API_KEY = 'minimax-test'
      legacyProvider = 'minimax'
      firstPartyAnthropicBaseUrl = false
      break
    case 'codex':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex'
      process.env.OPENAI_MODEL = 'codexplan'
      legacyProvider = 'codex'
      firstPartyAnthropicBaseUrl = false
      break
  }

  const providerMock = () => ({
    ...actualProviders,
    getAPIProvider: () => legacyProvider,
    isFirstPartyAnthropicBaseUrl: () => firstPartyAnthropicBaseUrl,
  })
  mock.module('./providers.js', providerMock)
  mock.module('src/utils/model/providers.js', providerMock)
}

describe.serial('getAgentModel provider-aware fallback', () => {
  describe('Claude-native providers', () => {
    test('haiku alias resolves to haiku model for official Anthropic API', async () => {
      useProvider('anthropic')

      const { getAgentModel } = await importFreshAgentModule()
      useProvider('anthropic')
      resetModelStringsForTestingOnly()
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      expect(result).toContain('haiku')
      expect(result).not.toBe('claude-sonnet-4-6')
    })

    test('haiku alias resolves for Bedrock provider', async () => {
      useProvider('bedrock')

      const { getAgentModel } = await importFreshAgentModule()
      useProvider('bedrock')
      resetModelStringsForTestingOnly()
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      expect(result).toContain('haiku')
    })

    test('haiku alias resolves for Vertex provider', async () => {
      useProvider('vertex')

      const { getAgentModel } = await importFreshAgentModule()
      useProvider('vertex')
      resetModelStringsForTestingOnly()
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      expect(result).toContain('haiku')
    })

    test('haiku alias resolves for Foundry provider', async () => {
      useProvider('foundry')

      const { getAgentModel } = await importFreshAgentModule()
      useProvider('foundry')
      resetModelStringsForTestingOnly()
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      expect(result).toContain('haiku')
    })
  })

  describe('Non-Claude-native providers', () => {
    test('haiku alias inherits parent model for OpenAI provider', async () => {
      useProvider('openai')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Gemini provider', async () => {
      useProvider('gemini')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'gemini-2.5-pro', undefined, 'default')

      expect(result).toBe('gemini-2.5-pro')
    })

    test('haiku alias inherits parent model for custom Anthropic-compatible URL', async () => {
      useProvider('custom-anthropic')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      expect(result).toBe('claude-sonnet-4-6')
    })

    test('sonnet alias inherits parent model for OpenAI provider', async () => {
      useProvider('openai')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('sonnet', 'gpt-4o-mini', undefined, 'default')

      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Mistral provider', async () => {
      useProvider('mistral')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'mistral-small-latest', undefined, 'default')

      expect(result).toBe('mistral-small-latest')
    })

    test('haiku alias inherits parent model for GitHub Copilot provider', async () => {
      useProvider('github')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for NVIDIA NIM provider', async () => {
      useProvider('nvidia-nim')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'meta/llama-3.1-8b-instruct', undefined, 'default')

      expect(result).toBe('meta/llama-3.1-8b-instruct')
    })

    test('haiku alias inherits parent model for MiniMax provider', async () => {
      useProvider('minimax')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'MiniMax-M2.5-highspeed', undefined, 'default')

      expect(result).toBe('MiniMax-M2.5-highspeed')
    })

    test('haiku alias inherits parent model for Codex provider', async () => {
      useProvider('codex')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('haiku', 'gpt-5.5-mini', undefined, 'default')

      expect(result).toBe('gpt-5.5-mini')
    })
  })

  describe('inherit behavior unchanged', () => {
    test('inherit always returns parent model regardless of provider', async () => {
      useProvider('openai')

      const { getAgentModel } = await importFreshAgentModule()
      const result = getAgentModel('inherit', 'gpt-4o', undefined, 'default')

      expect(result).toBe('gpt-4o')
    })
  })

  describe('checkIsClaudeNativeProvider helper', () => {
    test('returns true for official Anthropic API', async () => {
      useProvider('anthropic')

      const { checkIsClaudeNativeProvider } = await importFreshAgentModule()
      useProvider('anthropic')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Bedrock provider', async () => {
      useProvider('bedrock')

      const { checkIsClaudeNativeProvider } = await importFreshAgentModule()
      useProvider('bedrock')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Vertex provider', async () => {
      useProvider('vertex')

      const { checkIsClaudeNativeProvider } = await importFreshAgentModule()
      useProvider('vertex')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Foundry provider', async () => {
      useProvider('foundry')

      const { checkIsClaudeNativeProvider } = await importFreshAgentModule()
      useProvider('foundry')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns false for OpenAI provider', async () => {
      useProvider('openai')

      const { checkIsClaudeNativeProvider } = await importFreshAgentModule()
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })

    test('returns false for custom Anthropic URL', async () => {
      useProvider('custom-anthropic')

      const { checkIsClaudeNativeProvider } = await importFreshAgentModule()
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })
  })
})
