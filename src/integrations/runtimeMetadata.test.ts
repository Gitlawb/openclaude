import { describe, it, expect } from 'bun:test'
import { resolveOpenAIShimRuntimeContext } from '../integrations/runtimeMetadata'

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
