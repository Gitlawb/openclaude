import { defineModel } from '../define.js'

// Unknown models fall back to src/utils/model/openaiContextWindows.ts
// Gateway onboarding should not require editing this file.

export default [
  defineModel({
    id: 'qwen3.6-plus',
    label: 'Qwen 3.6 Plus',
    brandId: 'qwen',
    vendorId: 'openai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'qwen3.6-plus',
    capabilities: {
      supportsVision: true,
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
