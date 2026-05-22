import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'gitlawb-opengateway',
  label: 'Gitlawb Opengateway',
  category: 'aggregating',
  defaultBaseUrl: 'https://opengateway.gitlawb.com/v1',
  defaultModel: 'mimo-v2.5-pro',
  supportsModelRouting: true,
  vendorId: 'openai',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENGATEWAY_API_KEY', 'GITLAWB_API_KEY', 'OPENAI_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    credentialEnvVars: ['OPENGATEWAY_API_KEY', 'GITLAWB_API_KEY', 'OPENAI_API_KEY'],
    routing: {
      matchBaseUrlHosts: ['opengateway.gitlawb.com', 'opengateway.fly.dev'],
    },
    missingCredentialMessage:
      'OPENGATEWAY_API_KEY (or GITLAWB_API_KEY) is required to use Gitlawb Opengateway.',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      defaultAuthHeader: {
        name: 'Authorization',
        scheme: 'bearer',
      },
      maxTokensField: 'max_completion_tokens',
      removeBodyFields: ['store', 'stream_options'],
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'gitlawb-opengateway',
    description: 'Gitlawb Opengateway — free hosted Xiaomi MiMo + GMI Cloud partner models (API key required)',
    label: 'Gitlawb Opengateway',
    name: 'Gitlawb Opengateway',
    vendorId: 'openai',
    apiKeyEnvVars: ['OPENGATEWAY_API_KEY', 'GITLAWB_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    baseUrlEnvVars: ['OPENGATEWAY_BASE_URL', 'OPENAI_BASE_URL'],
    fallbackBaseUrl: 'https://opengateway.gitlawb.com/v1',
    fallbackModel: 'mimo-v2.5-pro',
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'opengateway-mimo-v2.5-pro',
        apiName: 'mimo-v2.5-pro',
        label: 'MiMo V2.5 Pro (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5-pro',
      },
      {
        id: 'opengateway-mimo-v2-pro',
        apiName: 'mimo-v2-pro',
        label: 'MiMo V2 Pro (via Opengateway)',
        modelDescriptorId: 'mimo-v2-pro',
      },
      {
        id: 'opengateway-mimo-v2.5',
        apiName: 'mimo-v2.5',
        label: 'MiMo V2.5 (via Opengateway)',
        modelDescriptorId: 'mimo-v2.5',
      },
      {
        id: 'opengateway-mimo-v2-omni',
        apiName: 'mimo-v2-omni',
        label: 'MiMo V2 Omni (via Opengateway)',
        modelDescriptorId: 'mimo-v2-omni',
      },
      {
        id: 'opengateway-mimo-v2-flash',
        apiName: 'mimo-v2-flash',
        label: 'MiMo V2 Flash (via Opengateway)',
        modelDescriptorId: 'mimo-v2-flash',
      },
      {
        id: 'opengateway-gemini-3.1-flash-lite-preview',
        apiName: 'google/gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash Lite Preview (via Opengateway)',
        modelDescriptorId: 'gemini-3.1-flash-lite-preview',
      },
    ],
  },
  usage: { supported: false },
})
