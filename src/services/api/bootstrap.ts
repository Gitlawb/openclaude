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
  getOpenAICompatibleModelsBaseUrl,
  listOpenAICompatibleModels,
} from '../../utils/providerDiscovery.js'
import {
  listOpenRouterModels,
  type OpenRouterModel,
} from '../../utils/openRouterModels.js'
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
  const resolvedBaseUrl = getOpenAICompatibleModelsBaseUrl(baseUrl)
  const providerLabel = getLocalOpenAICompatibleProviderLabel(baseUrl)
  const apiKey =
    process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY

  // OpenRouter exposes pricing via its /models endpoint; prefer that over the
  // generic OpenAI-compatible listing so the picker can surface $/Mtok again.
  if (resolvedBaseUrl.includes('openrouter.ai')) {
    const models = await listOpenRouterModels(apiKey)
    if (models.length === 0) {
      logForDebugging('[Bootstrap] OpenRouter model discovery returned empty')
      return null
    }

    return {
      clientData: getGlobalConfig().clientDataCache ?? null,
      additionalModelOptionsScope: scope,
      additionalModelOptions: models.map(model => ({
        value: model.id,
        label: model.name,
        description: buildOpenRouterDescription(model, providerLabel),
      })),
    }
  }

  const models = await listOpenAICompatibleModels({
    baseUrl,
    apiKey,
  })

  if (models === null) {
    logForDebugging('[Bootstrap] Local OpenAI model discovery failed')
    return null
  }

  // Some local proxies (e.g. litellm) relay OpenRouter and return ids in
  // `provider/slug` form. When we spot those, enrich the descriptions with
  // OpenRouter's public pricing catalog so the picker surfaces $/Mtok.
  const priceMap = models.some(looksLikeOpenRouterId)
    ? await fetchOpenRouterPriceMap(apiKey)
    : null

  return {
    clientData: getGlobalConfig().clientDataCache ?? null,
    additionalModelOptionsScope: scope,
    additionalModelOptions: models.map(model => {
      const priced = priceMap?.get(model)
      return {
        value: model,
        label: priced?.name ?? model,
        description: priced
          ? buildOpenRouterDescription(priced, providerLabel)
          : `Detected from ${providerLabel}`,
      }
    }),
  }
}

function looksLikeOpenRouterId(id: string): boolean {
  // OpenRouter ids are `provider/slug` (optionally `:tag`). Match conservatively
  // so we don't ping OpenRouter for providers that happen to share an id style.
  return /^[a-z0-9._-]+\/[a-z0-9._-]+(:[a-z0-9._-]+)?$/i.test(id)
}

async function fetchOpenRouterPriceMap(
  apiKey: string | undefined,
): Promise<Map<string, OpenRouterModel> | null> {
  try {
    const catalog = await listOpenRouterModels(apiKey)
    if (catalog.length === 0) return null
    return new Map(catalog.map(m => [m.id, m]))
  } catch {
    return null
  }
}

function formatOpenRouterPrice(value: number): string {
  // OpenRouter ships prices down to fractions of a cent per Mtok — keep 2
  // decimals for typical $/Mtok and fall back to 4 for sub-cent rates so
  // tiny models don't flatten to "$0.00".
  if (!Number.isFinite(value)) return ''
  return value >= 0.1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

function formatOpenRouterContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`
  return `${tokens} ctx`
}

function buildOpenRouterDescription(
  model: { promptPricePerMToken: number | null; completionPricePerMToken: number | null; contextLength: number },
  providerLabel: string,
): string {
  const parts = [`Detected from ${providerLabel}`]

  const { promptPricePerMToken: prompt, completionPricePerMToken: completion } =
    model
  if (prompt !== null && completion !== null) {
    parts.push(
      `${formatOpenRouterPrice(prompt)} / ${formatOpenRouterPrice(completion)} per Mtok`,
    )
  } else if (prompt !== null) {
    parts.push(`${formatOpenRouterPrice(prompt)} per Mtok`)
  } else if (completion !== null) {
    parts.push(`${formatOpenRouterPrice(completion)} per Mtok`)
  }

  const ctx = formatOpenRouterContext(model.contextLength)
  if (ctx) parts.push(ctx)

  return parts.join(' · ')
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
