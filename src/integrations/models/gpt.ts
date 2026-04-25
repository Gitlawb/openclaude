import { defineModel } from '../define.js'

// Unknown models fall back to src/utils/model/openaiContextWindows.ts
// Gateway onboarding should not require editing this file.

export default [
  defineModel({
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    brandId: 'gpt',
    vendorId: 'openai',
    classification: ['chat', 'vision', 'coding'],
    defaultModel: 'gpt-5.4',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: true,
    },
    contextWindow: 400_000,
    maxOutputTokens: 16_384,
  }),
  defineModel({
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    brandId: 'gpt',
    vendorId: 'openai',
    classification: ['chat', 'vision'],
    defaultModel: 'gpt-5-mini',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: true,
    },
    contextWindow: 400_000,
    maxOutputTokens: 16_384,
  }),
  defineModel({
    id: 'gpt-4o',
    label: 'GPT-4o',
    brandId: 'gpt',
    vendorId: 'openai',
    classification: ['chat', 'vision'],
    defaultModel: 'gpt-4o',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: true,
    },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  }),
  defineModel({
    id: 'gpt-4o-mini',
    label: 'GPT-4o Mini',
    brandId: 'gpt',
    vendorId: 'openai',
    classification: ['chat', 'vision'],
    defaultModel: 'gpt-4o-mini',
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      supportsPreciseTokenCount: true,
    },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  }),
]
