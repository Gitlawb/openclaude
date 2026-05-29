import { defineGateway } from '../define.js'

/**
 * Perplexity AI provider — OpenAI-compatible /chat/completions endpoint.
 * Enable with CLAUDE_CODE_USE_PERPLEXITY=1 and set PERPLEXITY_API_KEY.
 *
 * @see src/utils/model/providers.ts — getAPIProvider() returns 'perplexity'
 * @see src/services/api/openaiShim.ts — PERPLEXITY_API_KEY -> OPENAI_API_KEY alias
 */
export default defineGateway({
  id: 'perplexity',
  label: 'Perplexity AI',
  category: 'hosted',
  defaultBaseUrl: 'https://api.perplexity.ai',
  defaultModel: 'sonar-pro',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['PERPLEXITY_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
      removeBodyFields: ['store'],
    },
  },
  preset: {
    id: 'perplexity',
    description: 'Perplexity AI OpenAI-compatible endpoint',
    apiKeyEnvVars: ['PERPLEXITY_API_KEY'],
    vendorId: 'openai',
  },
  validation: {
    kind: 'credential-env',
    routing: {
      enablementEnvVar: 'CLAUDE_CODE_USE_PERPLEXITY',
    },
    credentialEnvVars: ['PERPLEXITY_API_KEY'],
    missingCredentialMessage:
      'PERPLEXITY_API_KEY is required when CLAUDE_CODE_USE_PERPLEXITY=1.',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'perplexity-sonar-pro', apiName: 'sonar-pro', label: 'Sonar Pro', modelDescriptorId: 'sonar-pro' },
      { id: 'perplexity-sonar', apiName: 'sonar', label: 'Sonar', modelDescriptorId: 'sonar' },
      { id: 'perplexity-sonar-reasoning-pro', apiName: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro', modelDescriptorId: 'sonar-reasoning-pro' },
      { id: 'perplexity-sonar-reasoning', apiName: 'sonar-reasoning', label: 'Sonar Reasoning', modelDescriptorId: 'sonar-reasoning' },
    ],
  },
  usage: { supported: false },
})
