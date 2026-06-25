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
    id: 'xai/grok-build-0.1',
    label: 'Grok Build 0.1',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'xai/grok-build-0.1',
    capabilities: {
      ...grokCapabilities,
      supportsVision: false,
    },
    contextWindow: 262_144,
    maxOutputTokens: 262_144,
  }),
  defineModel({
    id: 'grok-4.3',
    label: 'Grok 4.3',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'grok-4.3',
    capabilities: grokCapabilities,
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
  }),
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
    id: 'grok-code-fast-1',
    label: 'Grok Code Fast 1',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'grok-code-fast-1',
    capabilities: {
      ...grokCapabilities,
      supportsVision: false,
    },
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
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
