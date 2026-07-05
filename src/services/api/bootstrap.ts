import isEqual from 'lodash-es/isEqual.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import {
  getLocalOpenAICompatibleProviderLabel,
  listOpenAICompatibleModels,
} from '../../utils/providerDiscovery.js'
import {
  getAdditionalModelOptionsCacheScope,
  resolveProviderRequest,
} from './providerConfig.js'

type BootstrapCachePayload = {
  clientData: Record<string, unknown> | null
  additionalModelOptions: ModelOption[]
  additionalModelOptionsScope: string
}

async function fetchLocalOpenAIModelOptions(): Promise<BootstrapCachePayload | null> {
  const scope = getAdditionalModelOptionsCacheScope()
  if (!scope?.startsWith('openai:')) {
    return null
  }

  const { baseUrl } = resolveProviderRequest()
  const models = await listOpenAICompatibleModels({
    baseUrl,
    apiKey: process.env.OPENAI_API_KEY,
  })

  if (models === null) {
    logForDebugging('[Bootstrap] Local OpenAI model discovery failed')
    return null
  }

  const providerLabel = getLocalOpenAICompatibleProviderLabel(baseUrl)

  return {
    clientData: getGlobalConfig().clientDataCache ?? null,
    additionalModelOptionsScope: scope,
    additionalModelOptions: models.map(model => ({
      value: model,
      label: model,
      description: `Detected from ${providerLabel}`,
    })),
  }
}

/**
 * Fetch bootstrap data from the API and persist to disk cache.
 */
export async function fetchBootstrapData(): Promise<void> {
  try {
    const scope = getAdditionalModelOptionsCacheScope()
    let payload: BootstrapCachePayload | null = null

    if (scope?.startsWith('openai:')) {
      payload = await fetchLocalOpenAIModelOptions()
      if (!payload) return
    } else {
      logForDebugging('[Bootstrap] Skipped: no additional model source')
      return
    }

    const { clientData, additionalModelOptions, additionalModelOptionsScope } =
      payload

    // Only persist if data actually changed — avoids a config write on every startup.
    const config = getGlobalConfig()
    if (
      isEqual(config.clientDataCache, clientData) &&
      isEqual(config.additionalModelOptionsCache, additionalModelOptions) &&
      config.additionalModelOptionsCacheScope === additionalModelOptionsScope
    ) {
      logForDebugging('[Bootstrap] Cache unchanged, skipping write')
      return
    }

    logForDebugging('[Bootstrap] Cache updated, persisting to disk')
    saveGlobalConfig(current => ({
      ...current,
      clientDataCache: clientData,
      additionalModelOptionsCache: additionalModelOptions,
      additionalModelOptionsCacheScope: additionalModelOptionsScope,
    }))
  } catch (error) {
    logError(error)
  }
}
