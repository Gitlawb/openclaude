import { defineModel } from '../define.js'

export default [
  defineModel({
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    label: 'Llama 3.1 Nemotron 70B Instruct',
    brandId: 'nemotron',
    vendorId: 'openai',
    classification: ['chat'],
    defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct',
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
  }),
]
