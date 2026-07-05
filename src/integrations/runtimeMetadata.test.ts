import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock'
import {
  resolveModelRuntimeLimits,
  resolveOpenAIShimRuntimeContext,
} from '../integrations/runtimeMetadata'
import { setCachedModels } from './discoveryCache'
import { getDiscoveryCacheKey } from './discoveryService'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

async function withTempConfigDir<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSharedMutationLock('integrations/runtimeMetadata.test.ts')
  let tempDir: string | null = null
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'openclaude-runtime-metadata-test-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    return await fn()
  } finally {
    try {
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    } finally {
      releaseSharedMutationLock()
    }
  }
}

describe('resolveModelRuntimeLimits', () => {
  it('uses discovered custom route context windows from the discovery cache', async () => {
    await withTempConfigDir(async () => {
      const baseUrl = 'http://localhost:4000/v1'
      await setCachedModels(
        getDiscoveryCacheKey('custom', {
          baseUrl,
        }),
        {
          models: [
            {
              id: 'litellm-proxy',
              apiName: 'litellm-proxy',
              label: 'litellm-proxy',
              contextWindow: 1_000_000,
            },
          ],
        },
      )

      expect(
        resolveModelRuntimeLimits({
          model: 'litellm-proxy',
          processEnv: {
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: baseUrl,
          },
        }).contextWindow,
      ).toBe(1_000_000)
    })
  })
  it('uses built-in Z.AI GLM-5.2 runtime limits', () => {
    const limits = resolveModelRuntimeLimits({
      model: 'glm-5.2',
      processEnv: {
        OPENAI_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
      },
    })

    expect(limits.contextWindow).toBe(1_000_000)
    expect(limits.maxOutputTokens).toBe(131_072)
  })
  it('uses the applied provider profile route before generic custom base URL fallback', () => {
    const limits = resolveModelRuntimeLimits({
      model: 'kimi-k2.6',
      activeProfileProvider: 'opencode',
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: '1',
        OPENAI_BASE_URL: 'https://proxy.example.test/v1',
      },
    })

    expect(limits.contextWindow).toBe(262_144)
    expect(limits.maxOutputTokens).toBe(65_536)
  })

  it('preserves composite provider paths before generic last-segment fallbacks', () => {
    for (const model of [
      'openrouter/accounts/fireworks/models/deepseek-v4-pro',
      'openrouter/fireworks/models/deepseek-v4-pro',
    ]) {
      expect(
        resolveModelRuntimeLimits({
          model,
          processEnv: {
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
          },
        }).maxOutputTokens,
      ).toBe(32_768)
    }

    for (const model of [
      'openrouter/accounts/fireworks/models/llama-v3p1-70b-instruct',
      'openrouter/fireworks/models/llama-v3p1-70b-instruct',
    ]) {
      expect(
        resolveModelRuntimeLimits({
          model,
          processEnv: {
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
          },
        }).contextWindow,
      ).toBe(131_072)
    }
  })


  it('uses pooled OpenAI fallback credentials when reading discovered runtime limits', async () => {
    await withTempConfigDir(async () => {
      const baseUrl = 'http://localhost:4000/v1'
      await setCachedModels(
        getDiscoveryCacheKey('custom', {
          baseUrl,
          apiKey: 'key-a',
        }),
        {
          models: [
            {
              id: 'pooled-litellm-proxy',
              apiName: 'pooled-litellm-proxy',
              label: 'pooled-litellm-proxy',
              contextWindow: 2_000_000,
            },
          ],
        },
      )

      expect(
        resolveModelRuntimeLimits({
          model: 'pooled-litellm-proxy',
          processEnv: {
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: baseUrl,
            OPENAI_API_KEYS: 'key-a,key-b',
          },
        }).contextWindow,
      ).toBe(2_000_000)
    })
  })
})

describe('resolveOpenAIShimRuntimeContext - Z.AI GLM-5.2', () => {
  it.each([
    'glm-5.2',
    'glm-5.2?reasoning=high',
    'glm-5.2?thinking=disabled',
  ])('uses Z.AI GLM-5.2 shim settings for %s', model => {
    const result = resolveOpenAIShimRuntimeContext({
      model,
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      processEnv: {},
    })

    expect(result.routeId).toBe('zai')
    expect(result.catalogEntry?.id).toBe('glm-5.2')
    expect(result.openaiShimConfig.thinkingRequestFormat).toBe('zai-compatible')
    expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    expect(result.openaiShimConfig.requireReasoningContentOnAssistantMessages).toBe(true)
    expect(result.openaiShimConfig.enableToolStreaming).toBe(true)
  })
})

describe('resolveOpenAIShimRuntimeContext - Moonshot and Kimi Code catalog metadata', () => {
  it('uses Moonshot direct catalog order, limits, and reasoning controls', () => {
    expect(
      resolveModelRuntimeLimits({
        model: 'kimi-k2.7-code',
        baseUrl: 'https://api.moonshot.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 32_768 })

    expect(
      resolveModelRuntimeLimits({
        model: 'kimi-k2.6',
        baseUrl: 'https://api.moonshot.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 262_144 })

    expect(
      resolveModelRuntimeLimits({
        model: 'kimi-k2.5',
        baseUrl: 'https://api.moonshot.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 262_144 })

    const result = resolveOpenAIShimRuntimeContext({
      model: 'kimi-k2.7-code',
      baseUrl: 'https://api.moonshot.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })

    expect(result.routeId).toBe('moonshot')
    expect(result.descriptor?.catalog?.models?.map(model => model.id)).toEqual([
      'kimi-k2.7-code',
      'kimi-k2.6',
      'kimi-k2.5',
    ])
    expect(result.catalogEntry?.id).toBe('kimi-k2.7-code')
    expect(result.catalogEntry?.aliases).toContain('moonshotai/kimi-k2.7-code')
    expect(result.catalogEntry?.reasoning?.levels).toEqual(['low', 'medium', 'high'])
    expect(result.catalogEntry?.reasoning?.defaultLevel).toBe('medium')
    expect(result.openaiShimConfig.maxTokensField).toBe('max_tokens')
    expect(result.openaiShimConfig.removeBodyFields).toContain('store')

    const qualified = resolveOpenAIShimRuntimeContext({
      model: 'moonshotai/kimi-k2.7-code',
      baseUrl: 'https://api.moonshot.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(qualified.routeId).toBe('moonshot')
    expect(qualified.catalogEntry?.id).toBe('kimi-k2.7-code')
    expect(qualified.catalogEntry?.reasoning?.levels).toEqual(['low', 'medium', 'high'])
  })

  it('uses Kimi Code gateway catalog limits and reasoning controls', () => {
    expect(
      resolveModelRuntimeLimits({
        model: 'kimi-for-coding',
        baseUrl: 'https://api.kimi.com/coding/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 32_768 })

    const result = resolveOpenAIShimRuntimeContext({
      model: 'kimi-for-coding',
      baseUrl: 'https://api.kimi.com/coding/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })

    expect(result.routeId).toBe('kimi-code')
    expect(result.descriptor?.catalog?.models?.map(model => model.id)).toEqual([
      'kimi-k2.7-code',
      'kimi-for-coding',
    ])
    expect(result.catalogEntry?.id).toBe('kimi-for-coding')
    expect(result.catalogEntry?.reasoning?.levels).toEqual(['low', 'medium', 'high'])
    expect(result.catalogEntry?.reasoning?.defaultLevel).toBe('medium')
    expect(result.openaiShimConfig.maxTokensField).toBe('max_tokens')
    expect(result.openaiShimConfig.removeBodyFields).toContain('store')

    const k27 = resolveOpenAIShimRuntimeContext({
      model: 'kimi-k2.7-code',
      baseUrl: 'https://api.kimi.com/coding/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(k27.routeId).toBe('kimi-code')
    expect(k27.catalogEntry?.id).toBe('kimi-k2.7-code')
    expect(k27.catalogEntry?.reasoning?.levels).toEqual(['low', 'medium', 'high'])

    const qualified = resolveOpenAIShimRuntimeContext({
      model: 'moonshotai/kimi-k2.7-code',
      baseUrl: 'https://api.kimi.com/coding/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(qualified.routeId).toBe('kimi-code')
    expect(qualified.catalogEntry?.id).toBe('kimi-k2.7-code')
    expect(qualified.catalogEntry?.reasoning?.levels).toEqual(['low', 'medium', 'high'])
  })

  it('uses Atlas Cloud catalog limits for Moonshot Kimi K2.7 Code', () => {
    expect(
      resolveModelRuntimeLimits({
        model: 'moonshotai/kimi-k2.7-code',
        baseUrl: 'https://api.atlascloud.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 32_768 })

    const result = resolveOpenAIShimRuntimeContext({
      model: 'moonshotai/kimi-k2.7-code',
      baseUrl: 'https://api.atlascloud.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })

    expect(result.routeId).toBe('atlas-cloud')
    expect(result.catalogEntry?.id).toBe('moonshotai/kimi-k2.7-code')
    expect(result.catalogEntry?.reasoning?.levels).toEqual(['low', 'medium', 'high'])
    expect(result.catalogEntry?.reasoning?.defaultLevel).toBe('medium')
  })
})
describe('resolveOpenAIShimRuntimeContext - Hicap catalog metadata', () => {
  it('uses Hicap static model limits and per-model shim overrides', () => {
    expect(
      resolveModelRuntimeLimits({
        model: 'claude-opus-4.8',
        baseUrl: 'https://api.hicap.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 128_000 })

    expect(
      resolveModelRuntimeLimits({
        model: 'kimi-k2.7-code',
        baseUrl: 'https://api.hicap.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 262_144, maxOutputTokens: 262_144 })

    expect(
      resolveModelRuntimeLimits({
        model: 'gpt-5.4',
        baseUrl: 'https://api.hicap.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 1_050_000, maxOutputTokens: 128_000 })

    const glm = resolveOpenAIShimRuntimeContext({
      model: 'glm-5.2',
      baseUrl: 'https://api.hicap.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(glm.catalogEntry?.id).toBe('hicap-glm-5.2')
    expect(glm.catalogEntry?.reasoning?.levels).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(glm.openaiShimConfig.thinkingRequestFormat).toBe('zai-compatible')
    expect(glm.openaiShimConfig.maxTokensField).toBe('max_tokens')
    expect(glm.openaiShimConfig.removeBodyFields).toContain('store')
    expect(glm.openaiShimConfig.enableToolStreaming).toBe(true)

    const discoveredGlm = resolveOpenAIShimRuntimeContext({
      model: 'zai-org/GLM-5.2',
      baseUrl: 'https://api.hicap.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(discoveredGlm.catalogEntry?.id).toBe('hicap-glm-5.2')
    expect(discoveredGlm.openaiShimConfig.thinkingRequestFormat).toBe('zai-compatible')
    expect(discoveredGlm.openaiShimConfig.maxTokensField).toBe('max_tokens')

    const gpt54 = resolveOpenAIShimRuntimeContext({
      model: 'gpt-5.4',
      baseUrl: 'https://api.hicap.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(gpt54.routeId).toBe('hicap')
    expect(gpt54.catalogEntry?.id).toBe('hicap-gpt-5.4')
    expect(gpt54.catalogEntry?.reasoning?.levels).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(gpt54.openaiShimConfig.requiredApiFormat).toBe('responses')
    expect(gpt54.openaiShimConfig.maxTokensField).toBe('max_completion_tokens')

    const gpt55 = resolveOpenAIShimRuntimeContext({
      model: 'gpt-5.5',
      baseUrl: 'https://api.hicap.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(gpt55.catalogEntry?.id).toBe('hicap-gpt-5.5')
    expect(gpt55.openaiShimConfig.requiredApiFormat).toBe('responses')
    expect(gpt55.openaiShimConfig.maxTokensField).toBe('max_completion_tokens')

    const grok = resolveOpenAIShimRuntimeContext({
      model: 'grok-4.3',
      baseUrl: 'https://api.hicap.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(grok.catalogEntry?.reasoning?.levels).toEqual([
      'low',
      'medium',
      'high',
    ])
  })
})

describe('resolveOpenAIShimRuntimeContext - xAI catalog metadata', () => {
  it('uses live xAI model metadata and per-model shim overrides', () => {
    expect(
      resolveModelRuntimeLimits({
        model: 'grok-4.20-0309-reasoning',
        baseUrl: 'https://api.x.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 32_768 })

    const grok420Reasoning = resolveOpenAIShimRuntimeContext({
      model: 'grok-4.20',
      baseUrl: 'https://api.x.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(grok420Reasoning.catalogEntry?.id).toBe('grok-4.20-0309-reasoning')
    expect(grok420Reasoning.openaiShimConfig.endpointPath).toBe('/responses')
    expect(grok420Reasoning.openaiShimConfig.removeBodyFields).toContain('reasoning_effort')

    expect(
      resolveModelRuntimeLimits({
        model: 'grok-build-0.1',
        baseUrl: 'https://api.x.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 256_000, maxOutputTokens: 64_000 })

    const grok43 = resolveOpenAIShimRuntimeContext({
      model: 'grok-4',
      baseUrl: 'https://api.x.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(grok43.routeId).toBe('xai')
    expect(grok43.catalogEntry?.id).toBe('grok-4.3')
    expect(grok43.catalogEntry?.reasoning?.levels).toEqual([
      'low',
      'medium',
      'high',
    ])

    const build = resolveOpenAIShimRuntimeContext({
      model: 'grok-code-fast-1',
      baseUrl: 'https://api.x.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(build.routeId).toBe('xai')
    expect(build.catalogEntry?.id).toBe('grok-build-0.1')
    expect(build.catalogEntry?.capabilities?.supportsReasoning).toBe(false)
    expect(build.catalogEntry?.reasoning).toBeUndefined()
    expect(build.openaiShimConfig.endpointPath).toBe('/responses')
    expect(build.openaiShimConfig.removeBodyFields).toContain('reasoning_effort')
  })
})

describe('resolveOpenAIShimRuntimeContext - provider override route preference', () => {
  it('does not inherit ambient route config when the preferred base URL is unrecognized', () => {
    const result = resolveOpenAIShimRuntimeContext({
      model: 'gpt-4o',
      baseUrl: 'https://custom.example.test/v1',
      preferBaseUrlRoute: true,
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.groq.com/openai/v1',
      },
    })

    expect(result.routeId).toBeNull()
    expect(result.descriptor).toBeNull()
    expect(result.catalogEntry).toBeNull()
    expect(result.openaiShimConfig.removeBodyFields).toBeUndefined()
    expect(result.openaiShimConfig.thinkingRequestFormat).toBeUndefined()
  })
})

describe('resolveOpenAIShimRuntimeContext - segment-boundary heuristic', () => {
  describe('DeepSeek models', () => {
    it('should NOT infer preserveReasoningContent for custom aliases (false-positive case)', () => {
      // my-deepseek-rag is a custom alias, NOT a provider path
      // Should NOT trigger the DeepSeek detection
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'my-deepseek-rag',
      })
      // Custom aliases should NOT get preserveReasoningContent
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })

    it('should infer preserveReasoningContent for openrouter/deepseek/... paths (true-positive case)', () => {
      // openrouter/deepseek/deepseek-chat is a provider path with segments
      // Should trigger the DeepSeek detection
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'openrouter/deepseek/deepseek-chat',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
      expect(result.openaiShimConfig.reasoningContentFallback).toBe('')
    })

    it('should infer preserveReasoningContent for accounts/fireworks/... paths (true-positive case)', () => {
      // accounts/fireworks/models/deepseek-v3 is a provider path with multiple segments
      // Should trigger the DeepSeek detection
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'accounts/fireworks/models/deepseek-v3',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
      expect(result.openaiShimConfig.reasoningContentFallback).toBe('')
    })

    it('should infer preserveReasoningContent for deepseek-chat directly (standard case)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'deepseek-chat',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })

    it('should infer preserveReasoningContent for deepseek-coder (model name)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'deepseek-coder',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })
  })

  describe('Kimi/Moonshot models', () => {
    it('should NOT infer preserveReasoningContent for custom kimi aliases', () => {
      // Custom alias should not trigger
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'my-kimi-assistant',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })

    it('should infer preserveReasoningContent for moonshot AI paths', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'openrouter/moonshotai/moonshot-v1-8k',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })

    it('should infer preserveReasoningContent for direct moonshot model names', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'moonshot-v1-8k',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })
  })

  describe('Non-matching models', () => {
    it('should return undefined for gpt-4o (negative case)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'gpt-4o',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })

    it('should return undefined for claude models (negative case)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'claude-sonnet-4-20250514',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })
  })
  it('matches provider-prefixed model ids to built-in runtime limits', () => {
    expect(
      resolveModelRuntimeLimits({
        model: 'google/gemini-3.1-pro',
        activeProfileProvider: 'custom',
        processEnv: {
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://example-gateway.test/v1',
        },
      }).contextWindow,
    ).toBe(1_048_576)

    expect(
      resolveModelRuntimeLimits({
        model: 'moonshotai/kimi-k2.6',
        activeProfileProvider: 'nvidia-nim',
        processEnv: {
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://integrate.api.nvidia.com/v1',
        },
      }).contextWindow,
    ).toBe(262_144)
  })
})
