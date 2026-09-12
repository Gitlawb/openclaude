import axios from 'axios'
import { z } from 'zod'
import { VERBOO_API_BASE_URL } from '../../constants/oauth.js'
import { getClaudeAIOAuthTokensAsync } from '../../utils/auth.js'
import { withOAuth401Retry } from '../../utils/http.js'
import { parseApiEnvelope, toVerbooApiError } from './verbooApiError.js'

export const freeTokenStatusSchema = z.object({
  eligible: z.boolean(),
  state: z.enum(['unavailable', 'eligible', 'pending_setup', 'active', 'exhausted', 'activating', 'checkout_required', 'converted']),
  tokenLimit: z.number().int().nonnegative(), tokensUsed: z.number().int().nonnegative(), tokensRemaining: z.number().int().nonnegative(),
  groupId: z.string().uuid().optional(), subscriptionId: z.string().uuid().optional(),
  billingInterval: z.enum(['month', 'year']).optional(), accountingPending: z.boolean(),
  accountingBlocked: z.boolean().optional(),
  accountingOpenRequests: z.number().int().nonnegative().optional(),
  accountingRequestLimit: z.number().int().min(1).max(100).optional(),
  activationUrl: z.string().url(), checkoutUrl: z.string().url().optional(), attemptId: z.string().uuid().optional(),
})
export const freeTokenQuoteSchema = z.object({
  token: z.string().min(1), groupId: z.string().uuid(), groupName: z.string(),
  amountCents: z.number().int().nonnegative(), renewalAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3), billingInterval: z.enum(['month', 'year']), expiresAt: z.string().datetime({ offset: true }),
})
export type FreeTokenStatus = z.infer<typeof freeTokenStatusSchema>
export type FreeTokenQuote = z.infer<typeof freeTokenQuoteSchema>

async function request<S extends z.ZodTypeAny>(schema: S, path = '', body?: unknown, signal?: AbortSignal): Promise<z.output<S>> {
  return withOAuth401Retry(async () => {
    const tokens = await getClaudeAIOAuthTokensAsync()
    if (!tokens?.accessToken) throw new Error('Execute /login para ativar seu plano.')
    try {
      const response = await axios.request({
        url: `${VERBOO_API_BASE_URL}/api/me/free-tokens${path}`, method: body === undefined ? 'GET' : 'POST', data: body,
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' }, timeout: 20_000, signal,
      })
      return parseApiEnvelope(schema, response.data, 'tokens grátis')
    } catch (error) {
      if (signal?.aborted) throw error
      throw toVerbooApiError(error, 'Não foi possível confirmar a operação de tokens grátis.')
    }
  })
}
export const fetchFreeTokenStatus = (signal?: AbortSignal) => request(freeTokenStatusSchema, '', undefined, signal)
export const fetchFreeTokenQuote = (signal?: AbortSignal) => request(freeTokenQuoteSchema, '/activation', undefined, signal)
export const activateFreeTokens = (token: string, signal?: AbortSignal) => request(freeTokenStatusSchema, '/activate', { token }, signal)
export const setupFreeTokens = (groupId: string, billingInterval: 'month' | 'year', signal?: AbortSignal) => request(freeTokenStatusSchema, '/setup', { groupId, billingInterval }, signal)
