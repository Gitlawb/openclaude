import { defineModel } from '../define.js'

const proCapabilities = {
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsReasoning: true,
  supportsPreciseTokenCount: false,
}

const omniCapabilities = {
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsReasoning: true,
  supportsVision: true,
  supportsPreciseTokenCount: false,
}

export default [
  defineModel({
    id: 'mimo-v2.5-pro',
    label: 'MiMo V2.5 Pro',
    brandId: 'xiaomi-mimo',
    vendorId: 'xiaomi-mimo',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'mimo-v2.5-pro',
    capabilities: proCapabilities,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
  }),
  defineModel({
    id: 'mimo-v2.5',
    label: 'MiMo V2.5',
    brandId: 'xiaomi-mimo',
    vendorId: 'xiaomi-mimo',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'mimo-v2.5',
    capabilities: omniCapabilities,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
  }),
  defineModel({
    id: 'mimo-v2-flash',
    label: 'MiMo V2 Flash',
    brandId: 'xiaomi-mimo',
    vendorId: 'xiaomi-mimo',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'mimo-v2-flash',
    capabilities: proCapabilities,
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
  }),
]
