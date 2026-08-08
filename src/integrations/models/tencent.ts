import { defineModel } from '../define.js'

export default [
  defineModel({
    id: 'tencent/hy3',
    label: 'Tencent HY3',
    brandId: 'tencent',
    vendorId: 'openai',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'tencent/hy3',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 262_144,
    maxOutputTokens: 131_072,
  }),
]
