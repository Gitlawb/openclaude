/**
 * Xiaomi MiMo model list for the /model picker.
 */

import type { ModelOption } from './modelOptions.js'
import { getAPIProvider } from './providers.js'
import { isEnvTruthy } from '../envUtils.js'

export function isXiaomiMimoProvider(): boolean {
  if (isEnvTruthy(process.env.MIMO_API_KEY)) {
    return true
  }
  const baseUrl = process.env.OPENAI_BASE_URL ?? ''
  if (baseUrl.includes('xiaomimimo') || baseUrl.includes('mimo-v2')) {
    return true
  }
  return getAPIProvider() === 'xiaomi-mimo'
}

function getXiaomiMimoModels(): ModelOption[] {
  return [
    { value: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', description: 'Flagship - 1M context - 128K output - Chat/Code/Reasoning' },
    { value: 'mimo-v2-pro', label: 'MiMo V2 Pro', description: 'Advanced - 1M context - 128K output - Chat/Code/Reasoning' },
    { value: 'mimo-v2.5', label: 'MiMo V2.5', description: 'General - 1M context - 128K output - Vision/Chat/Code' },
    { value: 'mimo-v2-omni', label: 'MiMo V2 Omni', description: 'Omni - 256K context - 128K output - Vision/Chat/Code' },
    { value: 'mimo-v2-flash', label: 'MiMo V2 Flash', description: 'Fast - 256K context - 64K output - Chat/Code/Reasoning' },
  ]
}

let cachedXiaomiMimoOptions: ModelOption[] | null = null

export function getCachedXiaomiMimoModelOptions(): ModelOption[] {
  if (!cachedXiaomiMimoOptions) {
    cachedXiaomiMimoOptions = getXiaomiMimoModels()
  }
  return cachedXiaomiMimoOptions
}
