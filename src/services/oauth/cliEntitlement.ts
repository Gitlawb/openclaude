import { FreeTokensRequiredError, requestFreeTokenActivation } from './freeTokenActivation.js'
import { getClaudeAIOAuthTokensAsync } from '../../utils/auth.js'
import { errorMessage } from '../../utils/errors.js'
import { withOAuth401Retry } from '../../utils/http.js'
import {
  fetchSubscriptions,
  type SubscriptionResponse,
} from '../api/verbooSubscriptions.js'
import { hasCurrentSubscriptionAccess } from './subscriptionAccess.js'

const RECHECK_AFTER_SECONDS = 300

export type CLIEntitlement = {
  allowed: boolean
  reason:
    | 'free_tokens_exhausted'
    | 'free_tokens_activation_pending'
    | 'free_tokens_accounting_pending'
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'expired'
    | 'subscription_required'
  checkedAt: string
  validUntil?: string
  recheckAfterSeconds: number
}

let cache: {
  accessToken: string
  value: CLIEntitlement
  nextCheckAt: number
} | null = null
const inFlightByAccessToken = new Map<string, Promise<CLIEntitlement>>()

function nextCheckAt(value: CLIEntitlement, now: number): number {
  const serverDeadline = now + value.recheckAfterSeconds * 1_000
  if (!value.validUntil) return serverDeadline
  const validityDeadline = new Date(value.validUntil).getTime()
  return Number.isFinite(validityDeadline)
    ? Math.min(serverDeadline, validityDeadline)
    : serverDeadline
}

async function requestEntitlement(): Promise<CLIEntitlement> {
  const subscriptions = await withOAuth401Retry(async () => {
    const tokens = await getClaudeAIOAuthTokensAsync()
    if (!tokens?.accessToken) {
      throw new Error(
        'Sessão Verboo ausente. Execute `verboo /login` em um terminal interativo.',
      )
    }
    return fetchSubscriptions(tokens.accessToken)
  })
  return buildCLIEntitlementFromSubscriptions(subscriptions)
}

export function buildCLIEntitlementFromSubscriptions(
  subscriptions: SubscriptionResponse[],
  now = Date.now(),
): CLIEntitlement {
  const active = subscriptions.filter(subscription =>
    hasCurrentSubscriptionAccess(subscription, now) && (!subscription.freeTokens || subscription.freeTokens.state === 'converted' || (subscription.freeTokens.state === 'active' && !subscription.freeTokens.accountingPending && subscription.freeTokens.tokensRemaining > 0)),
  )
  const result: CLIEntitlement = {
    allowed: active.length > 0,
    reason: 'subscription_required',
    checkedAt: new Date(now).toISOString(),
    recheckAfterSeconds: RECHECK_AFTER_SECONDS,
  }

  if (active.length > 0) {
    result.reason = active.some(subscription => subscription.status === 'active')
      ? 'active'
      : 'trialing'
    const ends = active.map(subscription => subscription.currentPeriodEnd)
    if (ends.every((end): end is string => Boolean(end))) {
      result.validUntil = ends.reduce((latest, end) =>
        new Date(end).getTime() > new Date(latest).getTime() ? end : latest,
      )
    }
    return result
  }

  const free = subscriptions.find(subscription => subscription.freeTokens && ['active', 'exhausted', 'activating', 'checkout_required'].includes(subscription.freeTokens.state))?.freeTokens
  if (free) {
    result.reason = free.accountingPending ? 'free_tokens_accounting_pending' : ['activating', 'checkout_required'].includes(free.state) ? 'free_tokens_activation_pending' : 'free_tokens_exhausted'
    result.recheckAfterSeconds = 3
  } else if (subscriptions.some(subscription => subscription.status === 'past_due')) {
    result.reason = 'past_due'
  } else if (subscriptions.length > 0) {
    result.reason = 'expired'
  }
  return result
}

async function currentAccessToken(): Promise<string> {
  const tokens = await getClaudeAIOAuthTokensAsync()
  if (!tokens?.accessToken) {
    throw new Error(
      'Sessão Verboo ausente. Execute `verboo /login` em um terminal interativo.',
    )
  }
  return tokens.accessToken
}

export async function fetchCLIEntitlement(options?: {
  force?: boolean
}): Promise<CLIEntitlement> {
  const now = Date.now()
  const accessToken = await currentAccessToken()
  if (
    !options?.force &&
    cache?.accessToken === accessToken &&
    now < cache.nextCheckAt
  ) {
    return cache.value
  }
  const existing = inFlightByAccessToken.get(accessToken)
  if (existing) return existing

  const request = requestEntitlement()
    .then(value => {
      cache = {
        accessToken,
        value,
        nextCheckAt: nextCheckAt(value, Date.now()),
      }
      return value
    })
    .finally(() => {
      inFlightByAccessToken.delete(accessToken)
    })
  inFlightByAccessToken.set(accessToken, request)
  return request
}

export function clearCLIEntitlementCache(): void {
  cache = null
}

export function getCLIEntitlementDeniedMessage(
  reason: CLIEntitlement['reason'],
): string {
  switch (reason) {
    case 'free_tokens_exhausted':
    case 'free_tokens_activation_pending':
      return new FreeTokensRequiredError().message
    case 'free_tokens_accounting_pending':
      return 'Estamos confirmando o consumo de tokens grátis. Novas solicitações estão pausadas; tente novamente em instantes.'
    case 'past_due':
      return 'Sua assinatura Verboo Code está com pagamento pendente. Regularize-a para continuar usando a CLI.'
    case 'expired':
      return 'Sua assinatura Verboo Code expirou. Assine novamente para continuar usando a CLI.'
    case 'subscription_required':
      return 'Uma assinatura Verboo Code ativa é obrigatória para usar a CLI.'
    case 'active':
    case 'trialing':
      return 'A licença da CLI não está disponível para esta conta.'
  }
}

export async function assertCLIEntitlement(options?: {
  force?: boolean
}): Promise<CLIEntitlement> {
  const requestStartedAt = performance.now()
  let entitlement: CLIEntitlement
  try {
    entitlement = await fetchCLIEntitlement(options)
  } catch (error) {
    throw new Error(
      `Não foi possível validar sua assinatura Verboo Code: ${errorMessage(error)}. Novas solicitações foram bloqueadas; tente novamente em instantes.`,
    )
  }
  if (!entitlement.allowed && (entitlement.reason === 'free_tokens_exhausted' || entitlement.reason === 'free_tokens_activation_pending')) {
    if (await requestFreeTokenActivation({ requestStartedAt })) {
      clearCLIEntitlementCache()
      entitlement = await fetchCLIEntitlement({ force: true })
    } else throw new FreeTokensRequiredError()
  }
  if (!entitlement.allowed) {
    throw new Error(getCLIEntitlementDeniedMessage(entitlement.reason))
  }
  return entitlement
}
