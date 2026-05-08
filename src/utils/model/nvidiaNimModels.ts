/**
 * NVIDIA NIM model list for the /model picker.
 * Filtered to chat/instruct models only - embedding, reward, safety, vision, etc. excluded.
 */

import { getModelOptions } from '../../integrations/modelCatalog/catalog.js'
import { isEnvTruthy } from '../envUtils.js'
import type { ModelOption } from './modelOptions.js'
import { getAPIProvider } from './providers.js'

export function isNvidiaNimProvider(): boolean {
  // Check if explicitly set via NVIDIA_NIM or via provider flag
  if (isEnvTruthy(process.env.NVIDIA_NIM)) {
    return true
  }
  // Also check if using NVIDIA NIM endpoint
  const baseUrl = process.env.OPENAI_BASE_URL ?? ''
  if (baseUrl.includes('nvidia') || baseUrl.includes('integrate.api.nvidia')) {
    return true
  }
  return getAPIProvider() === 'nvidia-nim'
}

function getNvidiaNimModels(): ModelOption[] {
  return getModelOptions('nvidia-nim', 'thirdParty')
}

let cachedNvidiaNimOptions: ModelOption[] | null = null

export function getCachedNvidiaNimModelOptions(): ModelOption[] {
  if (!cachedNvidiaNimOptions) {
    cachedNvidiaNimOptions = getNvidiaNimModels()
  }
  return cachedNvidiaNimOptions
}
