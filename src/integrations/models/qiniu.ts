import { defineModel } from '../define.js'

export default [
  defineModel({
    id: 'deepseek-v3',
    label: 'DeepSeek V3',
    brandId: 'qiniu',
    vendorId: 'qiniu',
    classification: ['chat', 'coding'],
    defaultModel: 'deepseek-v3',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  }),
]
