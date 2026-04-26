import { describe, test, expect, afterEach } from 'bun:test'

// All provider-related environment variables that affect provider detection
const PROVIDER_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_GITHUB',
  'NVIDIA_NIM',
  'MINIMAX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CODEX_API_KEY',
]

// Clear all provider env vars and restore original after test
const clearProviderEnv = () => {
  const original: Record<string, string | undefined> = {}
  for (const key of PROVIDER_ENV_VARS) {
    original[key] = process.env[key]
    delete process.env[key]
  }
  return () => {
    for (const key of PROVIDER_ENV_VARS) {
      delete process.env[key]
    }
    for (const [key, value] of Object.entries(original)) {
      if (value !== undefined) {
        process.env[key] = value
      }
    }
  }
}

// Set specific env vars for a provider scenario
const setProviderEnv = (env: Record<string, string | undefined>) => {
  const restore = clearProviderEnv()
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[key] = value
    }
  }
  return restore
}

describe('getAgentModel provider-aware fallback', () => {
  let restoreEnv: () => void

  afterEach(() => {
    if (restoreEnv) restoreEnv()
  })

  describe('Claude-native providers', () => {
    test('haiku alias resolves to haiku model for official Anthropic API', async () => {
      // Clear all provider env vars, set Anthropic official API
      restoreEnv = setProviderEnv({
        ANTHROPIC_API_KEY: 'sk-ant-test',
        // ANTHROPIC_BASE_URL not set = defaults to api.anthropic.com
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias, not inherit parent
      expect(result).toContain('haiku')
      expect(result).not.toBe('claude-sonnet-4-6')
    })

    test('haiku alias resolves for Bedrock provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Bedrock
      expect(result).toContain('haiku')
    })

    test('haiku alias resolves for Vertex provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_VERTEX: '1',
        GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Vertex
      expect(result).toContain('haiku')
    })
  })

  describe('Non-Claude-native providers', () => {
    test('haiku alias inherits parent model for OpenAI provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI (no haiku concept)
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Gemini provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_GEMINI: '1',
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'gemini-2.0-flash',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gemini-2.5-pro', undefined, 'default')

      // Should inherit parent model for Gemini
      expect(result).toBe('gemini-2.5-pro')
    })

    test('haiku alias inherits parent model for custom Anthropic-compatible URL', async () => {
      restoreEnv = setProviderEnv({
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_BASE_URL: 'https://custom-anthropic-proxy.example.com',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should inherit parent for custom Anthropic-compatible URL
      expect(result).toBe('claude-sonnet-4-6')
    })

    test('sonnet alias inherits parent model for OpenAI provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('sonnet', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Mistral provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_MISTRAL: '1',
        MISTRAL_API_KEY: 'test-key',
        MISTRAL_MODEL: 'mistral-medium-latest',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'mistral-small-latest', undefined, 'default')

      // Should inherit parent model for Mistral (no haiku concept)
      expect(result).toBe('mistral-small-latest')
    })

    test('haiku alias inherits parent model for GitHub Copilot provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_GITHUB: '1',
        GITHUB_TOKEN: 'gh-test-token',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for GitHub Copilot
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for NVIDIA NIM provider', async () => {
      restoreEnv = setProviderEnv({
        NVIDIA_NIM: '1',
        NVIDIA_API_KEY: 'nvapi-test-key',
        OPENAI_MODEL: 'meta/llama-3.1-70b-instruct',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'meta/llama-3.1-8b-instruct', undefined, 'default')

      // Should inherit parent model for NVIDIA NIM (no haiku concept)
      expect(result).toBe('meta/llama-3.1-8b-instruct')
    })

    test('haiku alias inherits parent model for MiniMax provider', async () => {
      restoreEnv = setProviderEnv({
        MINIMAX_API_KEY: 'test-key',
        OPENAI_MODEL: 'MiniMax-M2.5',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'MiniMax-M2.5-highspeed', undefined, 'default')

      // Should inherit parent model for MiniMax (no haiku concept)
      expect(result).toBe('MiniMax-M2.5-highspeed')
    })

    test('haiku alias inherits parent model for Codex provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_OPENAI: '1',
        CODEX_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-5.5',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-5.5-mini', undefined, 'default')

      // Should inherit parent model for Codex provider (no haiku concept)
      expect(result).toBe('gpt-5.5-mini')
    })
  })

  describe('inherit behavior unchanged', () => {
    test('inherit always returns parent model regardless of provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o',
      })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('inherit', 'gpt-4o', undefined, 'default')

      expect(result).toBe('gpt-4o')
    })
  })

  describe('checkIsClaudeNativeProvider helper', () => {
    test('returns true for official Anthropic API', async () => {
      restoreEnv = setProviderEnv({
        ANTHROPIC_API_KEY: 'sk-ant-test',
        // ANTHROPIC_BASE_URL not set = defaults to api.anthropic.com
      })

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Bedrock provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      })

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Vertex provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_VERTEX: '1',
        GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json',
      })

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns false for OpenAI provider', async () => {
      restoreEnv = setProviderEnv({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o',
      })

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })

    test('returns false for custom Anthropic URL', async () => {
      restoreEnv = setProviderEnv({
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_BASE_URL: 'https://custom-proxy.example.com',
      })

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })
  })
})