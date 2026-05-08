import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  getAllModelsForProvider,
  getDefaultModelForProvider,
  getModelPricing,
  getProviderCatalog,
} from '../integrations/modelCatalog/catalog.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logEvent } from 'src/services/analytics/index.js'
import { setHasUnknownModelCost } from '../bootstrap/state.js'
import { isFastModeEnabled } from './fastMode.js'
import {
  getCanonicalName,
  getDefaultMainLoopModelSetting,
  type ModelShortName,
} from './model/model.js'

export type ModelCosts = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  promptCacheReadTokens: number
  webSearchRequests: number
}

const ZERO_UNKNOWN_MODEL_COST: ModelCosts = {
  inputTokens: 0,
  outputTokens: 0,
  promptCacheWriteTokens: 0,
  promptCacheReadTokens: 0,
  webSearchRequests: 0,
}

function catalogPricingToModelCosts(
  pricing: NonNullable<ReturnType<typeof getModelPricing>>,
): ModelCosts {
  return {
    inputTokens: pricing.input,
    outputTokens: pricing.output,
    promptCacheWriteTokens: pricing.cacheWrite ?? 0,
    promptCacheReadTokens: pricing.cacheRead ?? 0,
    webSearchRequests: pricing.webSearch ?? 0,
  }
}

export function getCatalogModelCosts(
  model: string,
  options: {
    providerId?: string
    variant?: string
  } = {},
): ModelCosts | undefined {
  const pricing = getModelPricing(model, options.providerId ?? 'anthropic')
  if (!pricing) {
    return undefined
  }

  const variant = options.variant ? pricing.variants?.[options.variant] : undefined
  return catalogPricingToModelCosts({
    ...pricing,
    ...variant,
  })
}

function getDefaultUnknownModelCost(): ModelCosts {
  const fallbackModel =
    getDefaultModelForProvider('anthropic', 'opus') ??
    getDefaultModelForProvider('anthropic')
  return (
    (fallbackModel ? getCatalogModelCosts(fallbackModel, { providerId: 'anthropic' }) : undefined) ??
    ZERO_UNKNOWN_MODEL_COST
  )
}

function getFastModeCatalogModel(): string | undefined {
  return getAllModelsForProvider('anthropic').find(
    model => model.capabilities?.fastMode,
  )?.id
}

/**
 * Legacy helper name kept for callers; pricing is resolved from provider JSON.
 */
export function getOpus46CostTier(fastMode: boolean): ModelCosts {
  const model = getFastModeCatalogModel()
  return (
    (model
      ? getCatalogModelCosts(model, {
          providerId: 'anthropic',
          variant: isFastModeEnabled() && fastMode ? 'fastMode' : undefined,
        })
      : undefined) ?? getDefaultUnknownModelCost()
  )
}

// Model metadata source of truth: src/integrations/modelCatalog/providers/*.json
// Costs from https://platform.claude.com/docs/en/about-claude/pricing
// Web search cost: $10 per 1000 requests = $0.01 per request
export const MODEL_COSTS: Record<ModelShortName, ModelCosts> =
  Object.fromEntries(
    Object.keys(getProviderCatalog('anthropic')?.models ?? {}).flatMap(modelId => {
      const pricing = getModelPricing(modelId, 'anthropic')
      return pricing ? [[modelId, catalogPricingToModelCosts(pricing)]] : []
    }),
  )

/**
 * Calculates the USD cost based on token usage and model cost configuration
 */
function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * modelCosts.inputTokens +
    (usage.output_tokens / 1_000_000) * modelCosts.outputTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheReadTokens +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheWriteTokens +
    (usage.server_tool_use?.web_search_requests ?? 0) *
      modelCosts.webSearchRequests
  )
}

export function getModelCosts(model: string, usage: Usage): ModelCosts {
  const shortName = getCanonicalName(model)
  const isFastMode = isFastModeEnabled() && usage.speed === 'fast'
  const catalogPricing = getModelPricing(model, 'anthropic')
  const variant = isFastMode ? catalogPricing?.variants?.fastMode : undefined

  if (catalogPricing) {
    return catalogPricingToModelCosts({
      ...catalogPricing,
      ...variant,
    })
  }

  const costs = MODEL_COSTS[shortName]
  if (!costs) {
    trackUnknownModelCost(model, shortName)
    return (
      MODEL_COSTS[getCanonicalName(getDefaultMainLoopModelSetting())] ??
      getDefaultUnknownModelCost()
    )
  }
  return costs
}

function trackUnknownModelCost(model: string, shortName: ModelShortName): void {
  logEvent('tengu_unknown_model_cost', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    shortName:
      shortName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  setHasUnknownModelCost()
}

// Calculate the cost of a query in US dollars.
// If the model's costs are not found, use the default model's costs.
export function calculateUSDCost(resolvedModel: string, usage: Usage): number {
  const modelCosts = getModelCosts(resolvedModel, usage)
  return tokensToUSDCost(modelCosts, usage)
}

/**
 * Calculate cost from raw token counts without requiring a full BetaUsage object.
 * Useful for side queries (e.g. classifier) that track token counts independently.
 */
export function calculateCostFromTokens(
  model: string,
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  },
): number {
  const usage: Usage = {
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cache_read_input_tokens: tokens.cacheReadInputTokens,
    cache_creation_input_tokens: tokens.cacheCreationInputTokens,
  } as Usage
  return calculateUSDCost(model, usage)
}

function formatPrice(price: number): string {
  // Format price: integers without decimals, others with 2 decimal places
  // e.g., 3 -> "$3", 0.8 -> "$0.80", 22.5 -> "$22.50"
  if (Number.isInteger(price)) {
    return `$${price}`
  }
  return `$${price.toFixed(2)}`
}

/**
 * Format model costs as a pricing string for display
 * e.g., "$3/$15 per Mtok"
 */
export function formatModelPricing(costs: ModelCosts): string {
  return `${formatPrice(costs.inputTokens)}/${formatPrice(costs.outputTokens)} per Mtok`
}

export function formatModelPricingForModel(
  model: string,
  options: {
    providerId?: string
    variant?: string
  } = {},
): string | undefined {
  const costs = getCatalogModelCosts(model, options)
  return costs ? formatModelPricing(costs) : undefined
}

/**
 * Get formatted pricing string for a model
 * Accepts either a short name or full model name
 * Returns undefined if model is not found
 */
export function getModelPricingString(model: string): string | undefined {
  const costs = getCatalogModelCosts(model) ?? MODEL_COSTS[getCanonicalName(model)]
  if (!costs) return undefined
  return formatModelPricing(costs)
}
