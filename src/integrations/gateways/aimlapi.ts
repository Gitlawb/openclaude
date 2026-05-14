import { defineGateway } from '../define.js'

function mapAimlapiModel(raw: unknown) {
  const model = raw as {
    id?: string
    type?: string
    developer?: string
    contextLength?: number
    info?: {
      name?: string
      developer?: string
      contextLength?: number
    }
  }

  const id = model.id?.trim()
  if (!id || model.type !== 'openai/chat-completions') {
    return null
  }

  const info = model.info
  const developer = info?.developer?.trim() || model.developer?.trim()
  const displayName = info?.name?.trim()
  const label = displayName
    ? developer && !displayName.includes(`(${developer})`)
      ? `${displayName} (${developer})`
      : displayName
    : id
  const contextLength = info?.contextLength ?? model.contextLength

  return {
    id,
    apiName: id,
    label,
    ...(typeof contextLength === 'number' && contextLength > 0
      ? { contextWindow: contextLength }
      : {}),
  }
}

export default defineGateway({
  id: 'aimlapi',
  label: 'AI/ML API',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.aimlapi.com/v1',
  defaultModel: 'gpt-4o',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['AIMLAPI_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      headers: {
        'HTTP-Referer': 'OpenClaude',
        'X-Title': 'OpenClaude',
      },
      supportsAuthHeaders: false,
    },
  },
  preset: {
    id: 'aimlapi',
    description: 'AI/ML API OpenAI-compatible endpoint',
    apiKeyEnvVars: ['AIMLAPI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['api.aimlapi.com'],
    },
    credentialEnvVars: ['AIMLAPI_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'AI/ML API auth is required. Set AIMLAPI_API_KEY or OPENAI_API_KEY.',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      requiresAuth: false,
      mapModel: mapAimlapiModel,
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'startup',
    allowManualRefresh: true,
    models: [
      {
        id: 'aimlapi-gpt-4o',
        apiName: 'gpt-4o',
        label: 'GPT-4o',
        modelDescriptorId: 'gpt-4o',
      },
    ],
  },
  usage: { supported: false },
})
