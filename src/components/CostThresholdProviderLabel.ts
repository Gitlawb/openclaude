import type { APIProvider } from '../utils/model/providers.js'

const COST_THRESHOLD_PROVIDER_LABELS: Partial<Record<APIProvider, string>> = {
  firstParty: 'Anthropic API',
  bedrock: 'AWS Bedrock',
  vertex: 'Google Vertex',
  foundry: 'Azure Foundry',
  openai: 'OpenAI-compatible API',
  gemini: 'Gemini API',
}

export function getCostThresholdProviderLabelForProvider(
  provider: APIProvider,
): string {
  return COST_THRESHOLD_PROVIDER_LABELS[provider] ?? 'API'
}
