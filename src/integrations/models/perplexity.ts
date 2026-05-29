import { defineModel } from '../define.js'

const perplexityCapabilities = {
  supportsVision: false,
  supportsStreaming: true,
  supportsFunctionCalling: false,
  supportsJsonMode: false,
  supportsReasoning: false,
  supportsPreciseTokenCount: false,
}

function perplexityModel(
  id: string,
  label: string,
  contextWindow: number,
  maxOutputTokens: number,
) {
  return defineModel({
    id,
    label,
    brandId: 'perplexity',
    vendorId: 'openai',
    classification: ['chat'],
    defaultModel: id,
    capabilities: perplexityCapabilities,
    contextWindow,
    maxOutputTokens,
  })
}

export default [
  perplexityModel('sonar-pro', 'Sonar Pro', 200_000, 8_000),
  perplexityModel('sonar', 'Sonar', 127_072, 8_000),
  perplexityModel('sonar-reasoning-pro', 'Sonar Reasoning Pro', 200_000, 8_000),
  perplexityModel('sonar-reasoning', 'Sonar Reasoning', 127_072, 8_000),
  perplexityModel('sonar-deep-research', 'Sonar Deep Research', 128_000, 8_000),
]
