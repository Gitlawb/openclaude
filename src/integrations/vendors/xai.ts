import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'xai',
  label: 'xAI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.x.ai/v1',
  defaultModel: 'grok-4.3',
  requiredEnvVars: ['XAI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['XAI_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  preset: {
    id: 'xai',
    description: 'xAI Grok OpenAI-compatible endpoint',
    apiKeyEnvVars: ['XAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  validation: {
    kind: 'xai-credential',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.x.ai'],
    },
    credentialEnvVars: ['XAI_API_KEY'],
    // Saved OAuth profiles tag their env with this marker so validation
    // passes without re-reading secure storage.
    credentialSourceEnvMarkers: {
      XAI_CREDENTIAL_SOURCE: ['oauth'],
    },
    missingCredentialMessage:
      'XAI_API_KEY is required, or sign in with `openclaude auth xai login` (browser OAuth) or `openclaude auth xai device` (remote hosts).',
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'grok-4.3',
        apiName: 'grok-4.3',
        label: 'Grok 4.3',
        modelDescriptorId: 'grok-4.3',
      },
      {
        id: 'grok-4',
        apiName: 'grok-4',
        label: 'Grok 4',
        modelDescriptorId: 'grok-4',
      },
      {
        id: 'grok-code-fast-1',
        apiName: 'grok-code-fast-1',
        label: 'Grok Code Fast 1',
        modelDescriptorId: 'grok-code-fast-1',
      },
      {
        id: 'grok-3',
        apiName: 'grok-3',
        label: 'Grok 3',
        modelDescriptorId: 'grok-3',
      },
    ],
  },
  usage: { supported: false },
})
