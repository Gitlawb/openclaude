import { defineModel } from '../define.js'

// Unknown models fall back to src/utils/model/openaiContextWindows.ts
// Gateway onboarding should not require editing this file.

export default [
  defineModel({
    id: 'llama-3.3-70b',
    label: 'Llama 3.3 70B',
    brandId: 'llama',
    vendorId: 'openai',
    classification: ['chat'],
    defaultModel: 'llama-3.3-70b',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 4096,
  }),
  defineModel({
    id: 'llama-3.1-8b',
    label: 'Llama 3.1 8B',
    brandId: 'llama',
    vendorId: 'openai',
    classification: ['chat'],
    defaultModel: 'llama-3.1-8b',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 4096,
  }),
]
