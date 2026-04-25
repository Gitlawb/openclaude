import { defineGateway } from '../define.js'

/**
 * Mistral has dedicated runtime provider behavior that is not yet fully
 * normalized. It currently routes through the OpenAI shim but with
 * provider-specific handling. Do not collapse into generic openai-compatible
 * without preserving the existing Mistral-specific branches.
 *
 * @see src/utils/model/providers.ts — getAPIProvider() returns 'mistral'
 * @see src/services/api/openaiShim.ts — Mistral-specific shim branches
 */
export default defineGateway({
  id: 'mistral',
  label: 'Mistral AI',
  category: 'hosted',
  defaultBaseUrl: 'https://api.mistral.ai/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['MISTRAL_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsUserCustomHeaders: true,
    },
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'mistral-devstral', apiName: 'devstral-latest', label: 'Devstral Latest', default: true },
    ],
  },
  usage: { supported: false },
})
