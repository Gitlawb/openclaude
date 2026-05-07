import { defineModel } from '../define.js'

const geminiCapabilities = {
  supportsVision: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsReasoning: true,
  supportsPreciseTokenCount: false,
}

function geminiModel(id: string, label: string, maxOutputTokens: number) {
  return defineModel({
    id,
    label,
    brandId: 'gemini',
    vendorId: 'gemini',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: id,
    capabilities: geminiCapabilities,
    contextWindow: 1_048_576,
    maxOutputTokens,
  })
}

export default [
  geminiModel('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview', 65_536),
  geminiModel('gemini-3.1-pro', 'Gemini 3.1 Pro', 65_536),
  geminiModel('gemini-2.5-flash', 'Gemini 2.5 Flash', 65_536),
  geminiModel('gemini-2.5-pro', 'Gemini 2.5 Pro', 65_536),
  geminiModel('gemini-2.0-flash', 'Gemini 2.0 Flash', 8_192),
  geminiModel('google/gemini-2.5-pro', 'Google Gemini 2.5 Pro', 65_536),
  geminiModel('google/gemini-2.0-flash', 'Google Gemini 2.0 Flash', 8_192),
]
