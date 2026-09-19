import axios, { type AxiosRequestConfig } from 'axios'
import { setTimeout as pause } from 'node:timers/promises'
import { randomUUID, createHash } from 'node:crypto'
import { commercialOperation } from './revenueJourney.js'
import { z } from 'zod'

import { VERBOO_API_BASE_URL } from '../../constants/oauth.js'
import { isValidCPF } from '../oauth/purchaseValidation.js'
import {
  VerbooApiError,
  parseApiEnvelope,
  parseRequest,
  toVerbooApiError,
} from './verbooApiError.js'
import { fetchSubscriptions } from './verbooSubscriptions.js'

const httpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith('https://') || value.startsWith('http://'),
  )

const checkoutResultSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('stripe'),
      attemptId: z.string().uuid(),
      url: httpUrlSchema,
    })
    .passthrough(),
  z
    .object({
      mode: z.literal('woovi'),
      attemptId: z.string().uuid(),
      wooviQrCode: z.string().min(1),
      wooviSubscriptionId: z.string().min(1),
    })
    .passthrough(),
  z.object({ mode: z.literal('reactivated') }).passthrough(),
])

const checkoutInputSchema = z
  .object({
    paymentMethod: z.enum(['stripe', 'woovi']),
    billingInterval: z.enum(['month', 'year']).optional(),
    requestId: z.string().uuid().optional(),
    purchaseIntent: z.enum(['new', 'additional']).optional(),
    woovi: z
      .object({
        taxId: z
          .string()
          .regex(/^\d{11}$/)
          .refine(isValidCPF),
        phone: z.string().regex(/^\d{2}9\d{8}$/),
      })
      .optional(),
  })
  .superRefine((input, ctx) => {
    if (input.paymentMethod === 'woovi' && !input.woovi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Woovi payer data is required',
      })
    }
    if (input.paymentMethod === 'stripe' && input.woovi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Stripe checkout must not include Woovi data',
      })
    }
  })

const whatsappProfileSchema = z.discriminatedUnion('verified', [
  z
    .object({
      verified: z.literal(false),
      maskedPhone: z.string().optional(),
      countryCode: z.string().length(2).optional(),
    })
    .passthrough(),
  z
    .object({
      verified: z.literal(true),
      maskedPhone: z.string().min(1),
      countryCode: z.string().length(2),
      verifiedAt: z.string().datetime({ offset: true }).optional(),
    })
    .passthrough(),
])

const cardlessTrialInputSchema = z.discriminatedUnion('useVerifiedPhone', [
  z.object({ useVerifiedPhone: z.literal(true) }),
  z.object({
    useVerifiedPhone: z.literal(false),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    countryCode: z.string().length(2),
  }),
])

const verificationRequiredSchema = z
  .object({
    mode: z.literal('verification_required'),
    verificationId: z.string().uuid(),
    maskedPhone: z.string().min(1),
    expiresAt: z.string().datetime({ offset: true }),
    resendAt: z.string().datetime({ offset: true }),
    attemptsRemaining: z.number().int().nonnegative(),
  })
  .passthrough()

const trialActivatedSchema = z
  .object({
    mode: z.literal('trial_activated'),
    groupId: z.string().uuid(),
    status: z.literal('trialing'),
  })
  .passthrough()

const cardlessTrialResultSchema = z.discriminatedUnion('mode', [
  verificationRequiredSchema,
  trialActivatedSchema,
])

export type CheckoutResult = z.infer<typeof checkoutResultSchema>
export type PaymentMethod = 'stripe' | 'woovi'
export type WooviCheckoutData = { taxId: string; phone: string }
export type CheckoutInput = {
  billingInterval?: 'month' | 'year'
  requestId?: string
  purchaseIntent?: 'new' | 'additional'
  paymentMethod: PaymentMethod
  woovi?: WooviCheckoutData
}
export type WhatsAppProfile = z.infer<typeof whatsappProfileSchema>
export type CardlessTrialInput = z.input<typeof cardlessTrialInputSchema>
export type CardlessTrialResult = z.infer<typeof cardlessTrialResultSchema>
export type GroupEntitlementRequirement = 'access' | 'paid'

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

async function postAndParse<T>(
  endpoint: string,
  accessToken: string,
  body: unknown,
  schema: z.ZodType<T>,
  contractName: string,
  operationId?: string,
): Promise<T> {
  const observation = commercialOperation(endpoint.endsWith('/checkout') ? 'checkout_request' : 'trial_activation', operationId)
  try {
    const response = await axios.post(endpoint, body, {
      headers: {...authHeaders(accessToken), ...observation.headers},
      timeout: 10_000,
    })
    const result = parseApiEnvelope(schema, response.data, contractName)
    observation.complete()
    return result
  } catch (error) {
    const apiError = toVerbooApiError(
      error,
      `Não foi possível concluir ${contractName}.`,
    )
    observation.fail(apiError)
    throw apiError
  }
}

const checkoutRequests = new Map<string, string>()
function checkoutRequest(accessToken: string, groupId: string, input: CheckoutInput): string {
  if (input.requestId) return input.requestId
  let actor = accessToken
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
    if (typeof claims.sub === 'string' && z.string().uuid().safeParse(claims.sub).success) actor = claims.sub
  } catch { /* Opaque tokens remain bound to their exact authenticated token. */ }
  const binding = createHash('sha256').update(JSON.stringify([actor, groupId, input])).digest('hex')
  let id = checkoutRequests.get(binding)
  if (!id) {id = randomUUID();checkoutRequests.set(binding, id)}
  return id
}

async function commercialGet(url: string, config: AxiosRequestConfig) {
  const started = Date.now()
  for (let attempt = 1; ; attempt++) {
    try { return await axios.get(url, {...config, timeout: Math.min(10_000, 35_000-(Date.now()-started))}) }
    catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      const retryable = axios.isAxiosError(error) && error.code !== 'ERR_CANCELED' && (!status || [408,429,500,502,503,504].includes(status))
      const header = axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : undefined
      const seconds = header === undefined ? NaN : Number(header)
      const retryAfter = Number.isFinite(seconds) ? seconds*1000 : typeof header==='string' ? Date.parse(header)-Date.now() : 0
      const delay = Math.max(250*attempt, Number.isFinite(retryAfter) ? retryAfter : 0)
      if (!retryable || attempt===3 || config.signal?.aborted || Date.now()-started+delay+10_000>35_000) throw error
      await pause(delay, undefined, {signal:config.signal as AbortSignal | undefined})
    }
  }
}

export async function getPurchaseOptions(accessToken: string, groupId: string, billingInterval: 'month' | 'year') {
  const observation = commercialOperation('catalog')
  try {
    const response = await commercialGet(`${VERBOO_API_BASE_URL}/api/me/groups/${groupId}/purchase-options`, {headers: {...authHeaders(accessToken), ...observation.headers},params: {billingInterval},timeout: 10_000})
    const result = parseApiEnvelope(z.object({version: z.literal(1),groupId: z.string().uuid(),billingInterval: z.enum(['month', 'year']),recommendation: z.enum(['checkout', 'choose', 'change', 'manage', 'convert', 'resume', 'recover', 'support'])}),response.data,'opções de compra')
    if (result.groupId !== groupId || result.billingInterval !== billingInterval) throw new VerbooApiError({kind:'contract',code:'contract_error',message:'Opções de compra incompatíveis.'})
    observation.complete();return result
  } catch (error) {observation.fail(error);throw toVerbooApiError(error,'Não foi possível consultar as opções de compra.')}
}
export async function isPurchaseAttemptSucceeded(accessToken: string, attemptId: string, groupId: string, signal?: AbortSignal): Promise<boolean> {
  const observation = commercialOperation('payment_return', attemptId)
  try {
    const response = await commercialGet(`${VERBOO_API_BASE_URL}/api/me/purchase-attempts/${attemptId}`, {headers: {...authHeaders(accessToken), ...observation.headers},signal,timeout:10_000})
    const attempt = parseApiEnvelope(z.object({id:z.string().uuid(),groupId:z.string().uuid(),status:z.enum(['pending','requires_action','succeeded','failed','expired','review'])}),response.data,'confirmação da compra')
    if (attempt.id !== attemptId || attempt.groupId !== groupId) throw new VerbooApiError({kind:'contract',code:'contract_error',message:'Identidade de compra incompatível.'})
    if (['failed','expired','review'].includes(attempt.status)) throw new VerbooApiError({kind:'request',code:`purchase_attempt_${attempt.status}`,message:'A compra exige revisão no billing.'})
    observation.complete();return attempt.status === 'succeeded'
  } catch (error) {observation.fail(error);throw toVerbooApiError(error,'Não foi possível confirmar esta compra.')}
}

export async function createCheckoutSession(
  accessToken: string,
  groupId: string,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const requestId = checkoutRequest(accessToken,groupId,input)
  let request: z.infer<typeof checkoutInputSchema>
  try {
    parseRequest(z.string().uuid(), groupId, 'checkout')
    request = parseRequest(checkoutInputSchema, {...input, requestId, purchaseIntent: input.purchaseIntent ?? 'new'}, 'checkout')
  } catch (error) { commercialOperation('checkout_request', requestId).fail(error); throw error }
  return postAndParse(
    `${VERBOO_API_BASE_URL}/api/me/groups/${groupId}/checkout`,
    accessToken,
    request,
    checkoutResultSchema,
    'o checkout',
    requestId,
  )
}

export async function isWooviSubscriptionActive(
  accessToken: string,
  wooviSubscriptionId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const subscriptions = await fetchSubscriptions(accessToken, opts)
  return subscriptions.some(
    (sub) =>
      sub.wooviSubscriptionId === wooviSubscriptionId &&
      sub.status === 'active',
  )
}

export async function getWhatsAppProfile(
  accessToken: string,
): Promise<WhatsAppProfile> {
  const endpoint = `${VERBOO_API_BASE_URL}/api/me/whatsapp`
  try {
    const response = await axios.get(endpoint, {
      headers: authHeaders(accessToken),
      timeout: 10_000,
    })
    return parseApiEnvelope(
      whatsappProfileSchema,
      response.data,
      'perfil do WhatsApp',
    )
  } catch (error) {
    throw toVerbooApiError(
      error,
      'Não foi possível consultar o WhatsApp verificado.',
    )
  }
}

export async function startCardlessTrial(
  accessToken: string,
  groupId: string,
  input: CardlessTrialInput,
): Promise<CardlessTrialResult> {
  parseRequest(z.string().uuid(), groupId, 'trial')
  const request = parseRequest(cardlessTrialInputSchema, input, 'trial')
  return postAndParse(
    `${VERBOO_API_BASE_URL}/api/me/groups/${groupId}/cardless-trial`,
    accessToken,
    request,
    cardlessTrialResultSchema,
    'o trial',
  )
}

export async function confirmCardlessTrial(
  accessToken: string,
  verificationId: string,
  code: string,
): Promise<CardlessTrialResult> {
  parseRequest(z.string().uuid(), verificationId, 'confirmação do trial')
  const request = parseRequest(
    z.object({ code: z.string().regex(/^\d{6}$/) }),
    { code },
    'confirmação do trial',
  )
  return postAndParse(
    `${VERBOO_API_BASE_URL}/api/me/cardless-trial-verifications/${verificationId}/confirm`,
    accessToken,
    request,
    cardlessTrialResultSchema,
    'a confirmação do trial',
  )
}

export async function resendCardlessTrialCode(
  accessToken: string,
  verificationId: string,
): Promise<z.infer<typeof verificationRequiredSchema>> {
  parseRequest(z.string().uuid(), verificationId, 'reenvio do código')
  return postAndParse(
    `${VERBOO_API_BASE_URL}/api/me/cardless-trial-verifications/${verificationId}/resend`,
    accessToken,
    undefined,
    verificationRequiredSchema,
    'o reenvio do código',
  )
}

export async function isGroupSubscriptionActive(
  accessToken: string,
  groupId: string,
  opts: {
    signal?: AbortSignal
    requirement?: GroupEntitlementRequirement
  } = {},
): Promise<boolean> {
  const subscriptions = await fetchSubscriptions(accessToken, opts)
  return hasGroupSubscriptionEntitlement(
    subscriptions,
    groupId,
    opts.requirement ?? 'access',
  )
}

export function hasGroupSubscriptionEntitlement(
  subscriptions: Awaited<ReturnType<typeof fetchSubscriptions>>,
  groupId: string,
  requirement: GroupEntitlementRequirement,
): boolean {
  return subscriptions.some((subscription) => {
    if (subscription.groupId !== groupId) return false
    if (requirement === 'access') {
      return subscription.status === 'active' || subscription.status === 'trialing'
    }
    return (
      subscription.status === 'active' &&
      (subscription.source === 'stripe' ||
        subscription.source === 'stripe_trial' ||
        subscription.source === 'woovi')
    )
  })
}
