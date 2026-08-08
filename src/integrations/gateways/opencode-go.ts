import { defineGateway } from '../define.js'
import { ZAI_GLM_OPENAI_SHIM } from '../transport/zaiGlmShim.js'
import type { ReasoningControlMode, ReasoningEffortLevel, ReasoningWireFormat } from '../descriptors.js'

type OpenCodeGoCatalogSpec = {
  id: string
  apiName: string
  label: string
  endpointPath?: string
  // GLM reasoning models served by this Z.AI-contract gateway: opt in to the
  // zai-compatible request shaping explicitly rather than via name inference.
  zaiGlm?: boolean
}

function catalogEntry(spec: OpenCodeGoCatalogSpec) {
  const openaiShim = {
    ...(spec.zaiGlm ? ZAI_GLM_OPENAI_SHIM : {}),
    ...(spec.endpointPath
      ? {
          endpointPath: spec.endpointPath,
          defaultAuthHeader: { name: 'x-api-key', scheme: 'raw' as const },
        }
      : {}),
  }

  return {
    id: `opencode-go-${spec.id}`,
    apiName: spec.apiName,
    label: spec.label,
    modelDescriptorId: `opencode-go-${spec.id}`,
    ...(spec.zaiGlm
      ? {
          capabilities: {
            supportsFunctionCalling: true,
            supportsJsonMode: true,
            supportsReasoning: true,
          },
          reasoning: {
            mode: 'levels' as ReasoningControlMode,
            levels: ['high', 'xhigh'] as ReasoningEffortLevel[],
            wireFormat: 'zai_compatible' as ReasoningWireFormat,
          },
        }
      : {}),
    ...(Object.keys(openaiShim).length > 0
      ? { transportOverrides: { openaiShim } }
      : {}),
  }
}

const goModels: OpenCodeGoCatalogSpec[] = [
  { id: 'glm-5.2', apiName: 'glm-5.2', label: 'GLM 5.2', zaiGlm: true },
  { id: 'qwen3.7-max', apiName: 'qwen3.7-max', label: 'Qwen3.7 Max', endpointPath: '/messages' },
  { id: 'kimi-k2.7-code', apiName: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
  { id: 'mimo-v2.5-pro', apiName: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro' },
  { id: 'deepseek-v4-pro', apiName: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'qwen3.7-plus', apiName: 'qwen3.7-plus', label: 'Qwen3.7 Plus', endpointPath: '/messages' },
  { id: 'minimax-m3', apiName: 'minimax-m3', label: 'MiniMax M3', endpointPath: '/messages' },
  { id: 'mimo-v2.5', apiName: 'mimo-v2.5', label: 'MiMo V2.5' },
  { id: 'deepseek-v4-flash', apiName: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'glm-5.1', apiName: 'glm-5.1', label: 'GLM 5.1', zaiGlm: true },
  { id: 'kimi-k2.6', apiName: 'kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'qwen3.6-plus', apiName: 'qwen3.6-plus', label: 'Qwen3.6 Plus', endpointPath: '/messages' },
  { id: 'minimax-m2.7', apiName: 'minimax-m2.7', label: 'MiniMax M2.7', endpointPath: '/messages' },
]

export default defineGateway({
  id: 'opencode-go',
  label: 'OpenCode Go',
  category: 'aggregating',
  defaultBaseUrl: 'https://opencode.ai/zen/go/v1',
  defaultModel: 'glm-5.1',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENCODE_API_KEY'],
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
    },
    credentialEnvVars: ['OPENCODE_API_KEY', 'OPENAI_API_KEYS', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'OPENCODE_API_KEY or OPENAI_API_KEYS / OPENAI_API_KEY is required. Get your API key from https://opencode.ai',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'opencode-go',
    vendorId: 'openai',
    description: 'OpenCode Go - $10/mo subscription for open models (13 models)',
    apiKeyEnvVars: ['OPENCODE_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
  },
  catalog: {
    source: 'static',
    models: goModels.map(catalogEntry),
  },
  usage: { supported: false },
})
