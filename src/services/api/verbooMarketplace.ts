import axios from 'axios'
import { z } from 'zod'

import { VERBOO_API_BASE_URL } from '../../constants/oauth.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { parseApiEnvelope, toVerbooApiError } from './verbooApiError.js'

const paymentProviderSchema = z
  .union([z.enum(['stripe', 'woovi', 'both']), z.literal('')])
  .transform((value) => value || 'stripe')

const marketplaceGroupSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().optional(),
    priceCents: z.number().int().nonnegative(),
    currency: z.string().min(3),
    billingInterval: z.enum(['month', 'year']),
    instances: z.array(
      z
        .object({
          models: z.array(
            z.object({ modelName: z.string().min(1) }).passthrough(),
          ),
        })
        .passthrough(),
    ),
    memberCount: z.number().int().nonnegative().optional(),
    subscriberLimit: z.number().int().positive().nullable().optional(),
    freeTokens: z.number().int().nonnegative().optional(),
    freeTokensEligible: z.boolean().optional(),
    trialDays: z.number().int().positive().nullable().optional(),
    trialPaymentMethodRequired: z.boolean().default(false),
    trialEligible: z.boolean(),
    maxTokensPerSec: z.number().positive().nullable().optional(),
    paymentProvider: paymentProviderSchema,
    apiOnly: z.boolean(),
    isMember: z.boolean(),
    isOnWaitlist: z.boolean(),
    waitlistEnabled: z.boolean(),
    waitlistSubscribersOnly: z.boolean(),
  })
  .passthrough()

const marketplaceGroupsSchema = z.array(marketplaceGroupSchema)

export type MarketplaceGroup = z.infer<typeof marketplaceGroupSchema>

// Kept as a compatibility export for callers/tests. The authenticated purchase
// catalog is intentionally fetched fresh so eligibility and capacity do not go stale.
export function clearMarketplaceCache(): void {}

export async function fetchMarketplaceGroups(
  accessToken: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MarketplaceGroup[]> {
  const endpoint = `${VERBOO_API_BASE_URL}/api/marketplace`
  try {
    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      params: { apiOnly: false, includeMetrics: false },
      timeout: 10_000,
      signal: opts.signal,
    })
    const groups = parseApiEnvelope(
      marketplaceGroupsSchema,
      response.data,
      'catálogo de planos',
    ).filter((group) => !group.apiOnly)
    logForDebugging(
      `[Marketplace] Fetched ${groups.length} CLI plans from ${endpoint}`,
    )
    return groups
  } catch (error) {
    if (opts.signal?.aborted || axios.isCancel(error)) throw error
    const apiError = toVerbooApiError(
      error,
      'Não foi possível carregar os planos.',
    )
    logError(apiError)
    logForDebugging(
      `[Marketplace] ${apiError.code ?? apiError.kind}: ${apiError.message}`,
    )
    throw apiError
  }
}
