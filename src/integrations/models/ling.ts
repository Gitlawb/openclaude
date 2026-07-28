import { defineModel } from '../define.js'

export default [
  defineModel({
    id: 'inclusionai/ling-3.0-flash:free',
    label: 'Ling 3.0 Flash (free)',
    brandId: 'ling',
    vendorId: 'openai',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'inclusionai/ling-3.0-flash:free',
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
