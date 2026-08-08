import { defineModel } from '../define.js'

export default [
  defineModel({
    id: 'mindai/macaron-v1-tall',
    label: 'Macaron V1 Tall',
    brandId: 'macaron',
    vendorId: 'openai',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'mindai/macaron-v1-tall',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: false,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
  }),
]
