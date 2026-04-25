import { defineModel } from '../define.js'

// Unknown models fall back to src/utils/model/openaiContextWindows.ts
// Gateway onboarding should not require editing this file.

export default [
  defineModel({
    id: 'kimi-k2.5',
    label: 'Kimi K2.5',
    brandId: 'kimi',
    vendorId: 'moonshot',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'kimi-k2.5',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 256_000,
    maxOutputTokens: 8192,
  }),
  defineModel({
    id: 'kimi-k2.6',
    label: 'Kimi K2.6',
    brandId: 'kimi',
    vendorId: 'moonshot',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'kimi-k2.6',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 256_000,
    maxOutputTokens: 8192,
  }),
]
