import { defineModel } from '../define.js'

const mistralCapabilities = {
  supportsVision: false,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsReasoning: false,
  supportsPreciseTokenCount: false,
}

function mistralModel(
  id: string,
  label: string,
  contextWindow: number,
  maxOutputTokens: number,
) {
  return defineModel({
    id,
    label,
    brandId: 'mistral',
    vendorId: 'openai',
    classification: ['chat', 'coding'],
    defaultModel: id,
    capabilities: mistralCapabilities,
    contextWindow,
    maxOutputTokens,
  })
}

export default [
  mistralModel('mistral-large-latest', 'Mistral Large Latest', 256_000, 32_768),
  mistralModel('mistral-small-latest', 'Mistral Small Latest', 256_000, 32_768),
  mistralModel('devstral-latest', 'Devstral Latest', 256_000, 32_768),
  mistralModel('ministral-3b-latest', 'Ministral 3B Latest', 256_000, 32_768),
  mistralModel('mixtral-8x7b-32768', 'Mixtral 8x7B 32768', 32_768, 32_768),
  mistralModel('codestral', 'Codestral', 32_768, 8_192),
  mistralModel('mistral:7b', 'Mistral 7B', 32_768, 4_096),
]
