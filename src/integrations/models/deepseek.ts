import { defineModel } from '../define.js'

// Unknown models fall back to src/utils/model/openaiContextWindows.ts
// Gateway onboarding should not require editing this file.

export default [
  defineModel({
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    brandId: 'deepseek',
    vendorId: 'deepseek',
    classification: ['chat', 'coding'],
    defaultModel: 'deepseek-chat',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8192,
  }),
  defineModel({
    id: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner',
    brandId: 'deepseek',
    vendorId: 'deepseek',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'deepseek-reasoner',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8192,
  }),
  defineModel({
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    brandId: 'deepseek',
    vendorId: 'deepseek',
    classification: ['chat', 'coding'],
    defaultModel: 'deepseek-v4-flash',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8192,
  }),
  defineModel({
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    brandId: 'deepseek',
    vendorId: 'deepseek',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'deepseek-v4-pro',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8192,
  }),
]
