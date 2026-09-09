import axios from 'axios'
import { freeTokenStatusSchema } from './verbooFreeTokens.js'
import { z } from 'zod'

import { VERBOO_API_BASE_URL } from '../../constants/oauth.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { parseApiEnvelope, toVerbooApiError } from './verbooApiError.js'

export const subscriptionSourceSchema = z.union([
  z.enum([
    'stripe',
    'manual',
    'trial',
    'stripe_trial',
    'woovi',
    'managed_seat',
  ]),
  // Entitlement readers must stay forward-compatible with server-side
  // sources introduced after a CLI release.
  z.string().min(1),
])

const subscriptionSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid(),
    group: z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1),
        slug: z.string().min(1),
        priceCents: z.number().int().nonnegative(),
        currency: z.string().min(3),
        billingInterval: z.enum(['month', 'year']),
        status: z.string(),
        models: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    source: subscriptionSourceSchema.optional(),
    freeTokens: freeTokenStatusSchema.optional(),
    status: z.string().min(1),
    wooviSubscriptionId: z.string().optional(),
    currentPeriodStart: z.string().datetime({ offset: true }).optional(),
    currentPeriodEnd: z.string().datetime({ offset: true }).optional(),
    cancelAtPeriodEnd: z.boolean().default(false),
  })
  .passthrough()

const subscriptionsSchema = z.array(subscriptionSchema)
const portalSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine(
        (value) => value.startsWith('https://') || value.startsWith('http://'),
      ),
  })
  .passthrough()

export type SubscriptionResponse = z.infer<typeof subscriptionSchema>

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

export async function fetchSubscriptions(
  accessToken: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SubscriptionResponse[]> {
  const endpoint = `${VERBOO_API_BASE_URL}/api/me/subscriptions`
  try {
    const response = await axios.get(endpoint, {
      headers: authHeaders(accessToken),
      timeout: 10_000,
      signal: opts.signal,
    })
    return parseApiEnvelope(subscriptionsSchema, response.data, 'assinaturas')
  } catch (error) {
    if (opts.signal?.aborted || axios.isCancel(error)) throw error
    const apiError = toVerbooApiError(
      error,
      'Não foi possível validar suas assinaturas.',
    )
    logError(apiError)
    logForDebugging(
      `[Subscriptions] ${apiError.code ?? apiError.kind}: ${apiError.message}`,
    )
    throw apiError
  }
}

export async function fetchPortalUrl(accessToken: string): Promise<string> {
  const endpoint = `${VERBOO_API_BASE_URL}/api/me/subscriptions/portal`
  try {
    const response = await axios.get(endpoint, {
      headers: authHeaders(accessToken),
      timeout: 10_000,
    })
    return parseApiEnvelope(portalSchema, response.data, 'portal de pagamento')
      .url
  } catch (error) {
    const apiError = toVerbooApiError(
      error,
      'Não foi possível abrir o portal de pagamento.',
    )
    logError(apiError)
    logForDebugging(
      `[Subscriptions] portal ${apiError.code ?? apiError.kind}: ${apiError.message}`,
    )
    throw apiError
  }
}
