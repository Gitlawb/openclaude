import { defineModel } from '../define.js'

// Unknown models fall back to src/utils/model/openaiContextWindows.ts
// Gateway onboarding should not require editing this file.

export default [
  defineModel({
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    brandId: 'claude',
    vendorId: 'anthropic',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'claude-sonnet-4-6',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 200_000,
    maxOutputTokens: 8192,
  }),
  defineModel({
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    brandId: 'claude',
    vendorId: 'anthropic',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'claude-opus-4-6',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 200_000,
    maxOutputTokens: 8192,
  }),
  defineModel({
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    brandId: 'claude',
    vendorId: 'anthropic',
    classification: ['chat', 'vision'],
    defaultModel: 'claude-haiku-4-5',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 144_000,
    maxOutputTokens: 8192,
  }),
]
