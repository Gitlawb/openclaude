import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

describe('getAgentModel provider-aware fallback', () => {
  // Restore all mocks after each test
  afterEach(() => {
    mock.restore()
  })

  describe('Claude-native providers', () => {
    test('haiku alias resolves to haiku model for official Anthropic API', async () => {
      // Mock providers to return firstParty with official URL
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => true,
      }))

      // Import after mock is set up
      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias, not inherit parent
      expect(result).toContain('haiku')
      expect(result).not.toBe('claude-sonnet-4-6')
    })

    test('haiku alias resolves for Bedrock provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'bedrock',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Bedrock
      expect(result).toContain('haiku')
    })

    test('haiku alias resolves for Vertex provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'vertex',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Vertex
      expect(result).toContain('haiku')
    })

    test('haiku alias resolves for Foundry provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'foundry',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Foundry
      expect(result).toContain('haiku')
    })
  })

  describe('Non-Claude-native providers', () => {
    test('haiku alias inherits parent model for OpenAI provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI (no haiku concept)
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Gemini provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'gemini',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gemini-2.5-pro', undefined, 'default')

      // Should inherit parent model for Gemini
      expect(result).toBe('gemini-2.5-pro')
    })

    test('haiku alias inherits parent model for custom Anthropic-compatible URL', async () => {
      // firstParty provider but with custom URL (not official Anthropic)
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should inherit parent for custom Anthropic-compatible URL
      expect(result).toBe('claude-sonnet-4-6')
    })

    test('sonnet alias inherits parent model for OpenAI provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('sonnet', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Mistral provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'mistral',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'mistral-small-latest', undefined, 'default')

      // Should inherit parent model for Mistral (no haiku concept)
      expect(result).toBe('mistral-small-latest')
    })

    test('haiku alias inherits parent model for GitHub Copilot provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'github',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for GitHub Copilot
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for NVIDIA NIM provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'nvidia-nim',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'meta/llama-3.1-8b-instruct', undefined, 'default')

      // Should inherit parent model for NVIDIA NIM (no haiku concept)
      expect(result).toBe('meta/llama-3.1-8b-instruct')
    })

    test('haiku alias inherits parent model for MiniMax provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'minimax',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'MiniMax-M2.5-highspeed', undefined, 'default')

      // Should inherit parent model for MiniMax (no haiku concept)
      expect(result).toBe('MiniMax-M2.5-highspeed')
    })

    test('haiku alias inherits parent model for Codex provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'codex',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-5.5-mini', undefined, 'default')

      // Should inherit parent model for Codex provider (no haiku concept)
      expect(result).toBe('gpt-5.5-mini')
    })
  })

  describe('inherit behavior unchanged', () => {
    test('inherit always returns parent model regardless of provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('inherit', 'gpt-4o', undefined, 'default')

      expect(result).toBe('gpt-4o')
    })
  })

  describe('checkIsClaudeNativeProvider helper', () => {
    test('returns true for official Anthropic API', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => true,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Bedrock provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'bedrock',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Vertex provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'vertex',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Foundry provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'foundry',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns false for OpenAI provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })

    test('returns false for custom Anthropic URL', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })
  })
})