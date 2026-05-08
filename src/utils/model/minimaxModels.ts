/**
 * MiniMax model list for the /model picker.
 * Full model catalog from MiniMax API.
 */

import type { ModelOption } from './modelOptions.js'
import { getModelOptions } from '../../integrations/modelCatalog/catalog.js'
import { getAPIProvider } from './providers.js'
import { isEnvTruthy } from '../envUtils.js'

export function isMiniMaxProvider(): boolean {
  if (isEnvTruthy(process.env.MINIMAX_API_KEY)) {
    return true
  }
  const baseUrl = process.env.OPENAI_BASE_URL ?? ''
  if (baseUrl.includes('minimax')) {
    return true
  }
  return getAPIProvider() === 'minimax'
}

function getMiniMaxModels(): ModelOption[] {
  return getModelOptions('minimax', 'thirdParty')
}

let cachedMiniMaxOptions: ModelOption[] | null = null

export function getCachedMiniMaxModelOptions(): ModelOption[] {
  if (!cachedMiniMaxOptions) {
    cachedMiniMaxOptions = getMiniMaxModels()
  }
  return cachedMiniMaxOptions
}
