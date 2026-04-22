import axios from 'axios'
import isEqual from 'lodash-es/isEqual.js'
import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  hasProfileScope,
} from 'src/utils/auth.js'
import { z } from 'zod'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { withOAuth401Retry } from '../../utils/http.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import {
  getLocalOpenAICompatibleProviderLabel,
  listOpenAICompatibleModelOptions,
} from '../../utils/providerDiscovery.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import {
  getAdditionalModelOptionsCacheScope,
  resolveProviderRequest,
} from './providerConfig.js'

const bootstrapResponseSchema = lazySchema(() =>
  z.object({
    client_data: z.record(z.unknown()).nullish(),
    additional_model_options: z
      .array(
        z
          .object({
            model: z.string(),
            name: z.string(),
            description: z.string(),
          })
          .transform(({ model, name, description }) => ({
            value: model,
            label: name,
            description,
          })),
      )
      .nullish(),
  }),
)

type BootstrapResponse = z.infer<ReturnType<typeof bootstrapResponseSchema>>

type BootstrapCachePayload = {
  clientData: Record<string, unknown> | null
  additionalModelOptions: ModelOption[]
  additionalModelOptionsScope: string
}

async function fetchBootstrapAPI(): Promise<BootstrapResponse | null> {
  if (isEssentialTrafficOnly()) {
    logForDebugging('[Bootstrap] Skipped: Nonessential traffic disabled')
    return null
  }

  if (getAPIProvider() !== 'firstParty') {
    logForDebugging('[Bootstrap] Skipped: 3P provider')
    return null
  }

  // OAuth preferred (requires user:profile scope — service-key OAuth tokens
  // lack it and would 403). Fall back to API key auth for console users.
  const apiKey = getAnthropicApiKey()
  const hasUsableOAuth =
    getClaudeAIOAuthTokens()?.accessToken && hasProfileScope()
  if (!hasUsableOAuth && !apiKey) {
    logForDebugging('[Bootstrap] Skipped: no usable OAuth or API key')
    return null
  }

  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli/bootstrap`

  // withOAuth401Retry handles the refresh-and-retry. API key users fail
  // through on 401 (no refresh mechanism — no OAuth token to pass).
  try {
    return await withOAuth401Retry(async () => {
      // Re-read OAuth each call so the retry picks up the refreshed token.
      const token = getClaudeAIOAuthTokens()?.accessToken
      let authHeaders: Record<string, string>
      if (token && hasProfileScope()) {
        authHeaders = {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
        }
      } else if (apiKey) {
        authHeaders = { 'x-api-key': apiKey }
      } else {
        logForDebugging('[Bootstrap] No auth available on retry, aborting')
        return null
      }

      logForDebugging('[Bootstrap] Fetching')
      const response = await axios.get<unknown>(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getClaudeCodeUserAgent(),
          ...authHeaders,
        },
        timeout: 5000,
      })
      const parsed = bootstrapResponseSchema().safeParse(response.data)
      if (!parsed.success) {
        logForDebugging(
          `[Bootstrap] Response failed validation: ${parsed.error.message}`,
        )
        return null
      }
      logForDebugging('[Bootstrap] Fetch ok')
      return parsed.data
    })
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 'no-response'
      const code = error.code ?? 'unknown-code'
      const method = error.config?.method?.toUpperCase() ?? 'UNKNOWN'
      const requestUrl = error.config?.url ?? 'unknown-url'
      const message = error.message ?? 'unknown axios error'

      logForDebugging(
        `[Bootstrap] Fetch failed: status=${status} code=${code} method=${method} url=${requestUrl} message=${message}`,
      )
    } else {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(`[Bootstrap] Fetch failed: ${message}`)
    }

    throw error
  }
}

async function fetchLocalOpenAIModelOptions(): Promise<BootstrapCachePayload | null> {
  const scope = getAdditionalModelOptionsCacheScope()
  if (!scope?.startsWith('openai:')) {
    return null
  }

  const { baseUrl } = resolveProviderRequest()
  const models = await listOpenAICompatibleModelOptions({
    baseUrl,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.AIMLAPI_API_KEY,
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
      value: model.value,
      label: model.label,
      description:
        model.description || `Detected from ${providerLabel}`,
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

    if (scope === 'firstParty') {
      const response = await fetchBootstrapAPI()
      if (!response) return

      payload = {
        clientData: response.client_data ?? null,
        additionalModelOptions: response.additional_model_options ?? [],
        additionalModelOptionsScope: scope,
      }
    } else if (scope?.startsWith('openai:')) {
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
