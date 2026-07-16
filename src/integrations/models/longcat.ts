import { defineModel } from '../define.js'

export default [
  defineModel({
    id: 'LongCat-2.0',
    label: 'LongCat-2.0',
    brandId: 'longcat',
    vendorId: 'longcat',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'LongCat-2.0',
    capabilities: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      supportsPreciseTokenCount: false,
    },
    reasoning: {
      mode: 'levels',
      levels: ['high', 'xhigh'],
      defaultLevel: 'high',
      wireFormat: 'zai_compatible',
      disableFormat: 'thinking_type_disabled',
    },
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
  }),
]
