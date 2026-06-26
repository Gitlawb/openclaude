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
    id: 'grok-4.3',
    label: 'Grok 4.3',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'grok-4.3',
    capabilities: grokCapabilities,
    reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'], wireFormat: 'reasoning_effort' },
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
  }),
  defineModel({
    id: 'xai/grok-build-0.1',
    label: 'Grok Build 0.1',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'coding'],
    defaultModel: 'grok-build-0.1',
    capabilities: {
      ...grokCapabilities,
      supportsReasoning: false,
      supportsVision: false,
    },
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
  }),
  defineModel({
    id: 'grok-4.20-0309-reasoning',
    label: 'Grok 4.20 Reasoning',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'grok-4.20-0309-reasoning',
    capabilities: grokCapabilities,
    reasoning: { mode: 'always-on', wireFormat: 'none' },
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
  }),
  defineModel({
    id: 'grok-4.20-0309-non-reasoning',
    label: 'Grok 4.20 Non-Reasoning',
    brandId: 'xai',
    vendorId: 'xai',
    classification: ['chat', 'vision', 'coding'],
    defaultModel: 'grok-4.20-0309-non-reasoning',
    capabilities: {
      ...grokCapabilities,
      supportsReasoning: false,
    },
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
  }),
]
