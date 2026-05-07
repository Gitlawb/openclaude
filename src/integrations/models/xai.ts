import { defineModel } from '../define.js'

const grokCapabilities = {
  supportsVision: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsReasoning: true,
  supportsPreciseTokenCount: false,
}

export default [
  defineModel({
    id: 'grok-4',
    label: 'Grok 4',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'grok-4',
    capabilities: grokCapabilities,
    contextWindow: 2_000_000,
    maxOutputTokens: 32_768,
  }),
  defineModel({
    id: 'grok-3',
    label: 'Grok 3',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'grok-3',
    capabilities: grokCapabilities,
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
  }),
]
