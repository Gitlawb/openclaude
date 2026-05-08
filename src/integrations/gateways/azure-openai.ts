import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'azure-openai',
  label: 'Azure OpenAI',
  category: 'hosted',
  defaultBaseUrl: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
  supportsModelRouting: false,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['AZURE_OPENAI_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'azure-openai',
    description: 'Azure OpenAI endpoint (model=deployment name)',
    apiKeyEnvVars: ['AZURE_OPENAI_API_KEY'],
    vendorId: 'openai',
  },
  usage: { supported: false },
})
