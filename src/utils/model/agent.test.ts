import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalSubagentModel = process.env.CLAUDE_CODE_SUBAGENT_MODEL
const originalOpenAIModel = process.env.OPENAI_MODEL

type MockProvider =
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
  | 'codex'

function mockProvider(
  provider: MockProvider,
  isFirstPartyAnthropicBaseUrl = false,
): void {
  mock.module('./providers.js', () => ({
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => isFirstPartyAnthropicBaseUrl,
    isGithubNativeAnthropicMode: () => false,
    usesAnthropicAccountFlow: () => provider === 'firstParty',
  }))
}

describe('getAgentModel provider-aware fallback', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('utils/model/agent.test.ts')
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  })

  // Restore all mocks after each test
  afterEach(() => {
    try {
      mock.restore()
      if (originalSubagentModel === undefined) {
        delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
      } else {
        process.env.CLAUDE_CODE_SUBAGENT_MODEL = originalSubagentModel
      }
      if (originalOpenAIModel === undefined) {
        delete process.env.OPENAI_MODEL
      } else {
        process.env.OPENAI_MODEL = originalOpenAIModel
      }
    } finally {
      releaseSharedMutationLock()
    }
  })

  describe('Claude-native providers', () => {
    test('haiku alias resolves to haiku model for official Anthropic API', async () => {
      // Mock providers to return firstParty with official URL
      mockProvider('firstParty', true)

      // Import after mock is set up
      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias, not inherit parent
      expect(result).toContain('haiku')
      expect(result).not.toBe('claude-sonnet-4-6')
    })

    test('haiku alias resolves for Bedrock provider', async () => {
      mockProvider('bedrock')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Bedrock
      expect(result).toContain('haiku')
    })

    test('haiku alias resolves for Vertex provider', async () => {
      mockProvider('vertex')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Vertex
      expect(result).toContain('haiku')
    })

    test('haiku alias resolves for Foundry provider', async () => {
      mockProvider('foundry')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias for Foundry
      expect(result).toContain('haiku')
    })
  })

  describe('Non-Claude-native providers', () => {
    test('haiku alias inherits parent model for OpenAI provider', async () => {
      mockProvider('openai')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI (no haiku concept)
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Gemini provider', async () => {
      mockProvider('gemini')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gemini-2.5-pro', undefined, 'default')

      // Should inherit parent model for Gemini
      expect(result).toBe('gemini-2.5-pro')
    })

    test('haiku alias inherits parent model for custom Anthropic-compatible URL', async () => {
      // firstParty provider but with custom URL (not official Anthropic)
      mockProvider('firstParty')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should inherit parent for custom Anthropic-compatible URL
      expect(result).toBe('claude-sonnet-4-6')
    })

    test('sonnet alias inherits parent model for OpenAI provider', async () => {
      mockProvider('openai')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('sonnet', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for Mistral provider', async () => {
      mockProvider('mistral')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'mistral-small-latest', undefined, 'default')

      // Should inherit parent model for Mistral (no haiku concept)
      expect(result).toBe('mistral-small-latest')
    })

    test('haiku alias inherits parent model for GitHub Copilot provider', async () => {
      mockProvider('github')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for GitHub Copilot
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for NVIDIA NIM provider', async () => {
      mockProvider('nvidia-nim')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'meta/llama-3.1-8b-instruct', undefined, 'default')

      // Should inherit parent model for NVIDIA NIM (no haiku concept)
      expect(result).toBe('meta/llama-3.1-8b-instruct')
    })

    test('haiku alias inherits parent model for MiniMax provider', async () => {
      mockProvider('minimax')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'MiniMax-M2.5-highspeed', undefined, 'default')

      // Should inherit parent model for MiniMax (no haiku concept)
      expect(result).toBe('MiniMax-M2.5-highspeed')
    })

    test('haiku alias inherits parent model for Codex provider', async () => {
      mockProvider('codex')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-5.5-mini', undefined, 'default')

      // Should inherit parent model for Codex provider (no haiku concept)
      expect(result).toBe('gpt-5.5-mini')
    })
  })

  describe('inherit behavior unchanged', () => {
    test('inherit always returns parent model regardless of provider', async () => {
      mockProvider('openai')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('inherit', 'gpt-4o', undefined, 'default')

      expect(result).toBe('gpt-4o')
    })

    test('tool-specified inherit returns the runtime parent model', async () => {
      mockProvider('openai')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(undefined, 'gpt-4o', 'inherit', 'default')

      expect(result).toBe('gpt-4o')
    })

    test('tool-specified inherit is case-insensitive and trimmed', async () => {
      mockProvider('openai')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(undefined, 'gpt-4o', ' InHerit ', 'default')

      expect(result).toBe('gpt-4o')
    })
  })

  describe('tool-specified model override', () => {
    test('preserves custom provider model IDs unchanged', async () => {
      mockProvider('openai')

      const { getAgentModel } = await import('./agent.js')
      const customModels = [
        'gpt-5.5',
        'mimo-v2.5-pro',
        'deepseek-v4-flash',
        'deepseek/deepseek-v4-flash:nitro',
        'qwen3-coder-next:cloud',
        'custom_model-v1.2:fast',
      ]

      for (const customModel of customModels) {
        expect(
          getAgentModel(undefined, 'claude-sonnet-4-6', customModel, 'default'),
        ).toBe(customModel)
      }
    })

    test('trims custom provider model IDs before resolving', async () => {
      mockProvider('openai')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(
        undefined,
        'claude-sonnet-4-6',
        '  qwen3-coder-next:cloud  ',
        'default',
      )

      expect(result).toBe('qwen3-coder-next:cloud')
    })

    test('preserves alias tier matching for tool-specified aliases', async () => {
      mockProvider('firstParty', true)

      const { getAgentModel } = await import('./agent.js')

      expect(
        getAgentModel(undefined, 'claude-sonnet-4-6', 'sonnet', 'default'),
      ).toBe('claude-sonnet-4-6')
      expect(
        getAgentModel(undefined, 'claude-opus-4-6', 'opus', 'default'),
      ).toBe('claude-opus-4-6')
      expect(
        getAgentModel(
          undefined,
          'claude-3-5-haiku-20241022',
          'haiku',
          'default',
        ),
      ).toBe('claude-3-5-haiku-20241022')
    })

    test('keeps existing direct alias parsing for non-Claude providers', async () => {
      mockProvider('openai')
      delete process.env.OPENAI_MODEL

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(undefined, 'gpt-4o', 'haiku', 'default')

      expect(result).toBe('gpt-4o-mini')
    })

    test('CLAUDE_CODE_SUBAGENT_MODEL overrides tool-specified custom model', async () => {
      mockProvider('openai')
      process.env.CLAUDE_CODE_SUBAGENT_MODEL =
        'deepseek/deepseek-v4-flash:nitro'

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(
        'haiku',
        'claude-sonnet-4-6',
        'gpt-5.5',
        'default',
      )

      expect(result).toBe('deepseek/deepseek-v4-flash:nitro')
    })

    test('inherits Bedrock parent region prefix for non-prefixed Bedrock model IDs', async () => {
      mockProvider('bedrock')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(
        undefined,
        'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
        'default',
      )

      expect(result).toBe('eu.anthropic.claude-3-5-sonnet-20241022-v2:0')
    })

    test('preserves explicit Bedrock region prefix on tool-specified model IDs', async () => {
      mockProvider('bedrock')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(
        undefined,
        'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
        'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        'default',
      )

      expect(result).toBe('us.anthropic.claude-3-5-sonnet-20241022-v2:0')
    })

    test('does not apply Bedrock region prefixes to non-Bedrock custom IDs', async () => {
      mockProvider('bedrock')

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel(
        undefined,
        'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
        'deepseek/deepseek-v4-flash:nitro',
        'default',
      )

      expect(result).toBe('deepseek/deepseek-v4-flash:nitro')
    })
  })

  describe('checkIsClaudeNativeProvider helper', () => {
    test('returns true for official Anthropic API', async () => {
      mockProvider('firstParty', true)

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Bedrock provider', async () => {
      mockProvider('bedrock')

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Vertex provider', async () => {
      mockProvider('vertex')

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns true for Foundry provider', async () => {
      mockProvider('foundry')

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns false for OpenAI provider', async () => {
      mockProvider('openai')

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })

    test('returns false for custom Anthropic URL', async () => {
      mockProvider('firstParty')

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })
  })
})
