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
})
