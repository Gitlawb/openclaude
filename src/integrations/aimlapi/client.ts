/** AI/ML API passwordless onboarding and partner-checkout HTTP client. */

import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import type { AimlapiEndpoints } from './config.js'

export type PartnerCheckoutSessionStatus =
  | 'pending_auth'
  | 'pending_payment'
  | 'paid'
  | 'exchanging'
  | 'exchanged'
  | 'cancelled'
  | 'expired'
  | 'failed'

export type PartnerCheckoutSession = {
  id: string
  sessionToken: string
  partnerId: string
  partnerName: string | null
  userId: number | null
  amountUsdMinor: number | null
  status: PartnerCheckoutSessionStatus
  issuedKeyId: string | null
  returnUrl: string | null
}

export type PaymentSession = {
  providerSessionId: string
  payUrl: string | null
}

export type PayResult = {
  checkout: PaymentSession
  partnerCheckout: PartnerCheckoutSession
}

export type TopUpByKeyResult = PayResult

export type ExchangeResult = { apiKey: string; apiKeyId: string }
export type AuthResult = { token: string; exp: number }
export type AccountCheckResult = {
  action: 'sign-in' | 'sign-up'
  provider?: string | null
}
export type CreatedKey = { key: string; id: string }
export type BalanceResult = {
  balance: number
  lowBalance: boolean
  lowBalanceThreshold: number
}

const REQUEST_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BODY_BYTES = 1 << 20

function requestLabel(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'AI/ML API endpoint'
  }
}

function redactRequestSecrets(
  message: string,
  url: string,
  bearer: string | undefined,
): string {
  const secrets = new Set<string>()
  if (bearer?.trim()) secrets.add(bearer.trim())
  try {
    for (const segment of new URL(url).pathname.split('/')) {
      if (segment.length < 6) continue
      secrets.add(segment)
      try {
        secrets.add(decodeURIComponent(segment))
      } catch {
        // Keep the encoded segment when it is not valid percent-encoding.
      }
    }
  } catch {
    // The request label already handles malformed URLs without exposing them.
  }
  let redacted = message
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

const PARTNER_CHECKOUT_STATUSES: ReadonlySet<string> = new Set<PartnerCheckoutSessionStatus>([
  'pending_auth',
  'pending_payment',
  'paid',
  'exchanging',
  'exchanged',
  'cancelled',
  'expired',
  'failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAccountCheckResult(value: unknown): value is AccountCheckResult {
  return isRecord(value) && typeof value.action === 'string'
}

function isAuthResult(value: unknown): value is AuthResult {
  return isRecord(value) && isNonEmptyString(value.token)
}

function isCreatedKey(value: unknown): value is CreatedKey {
  return isRecord(value) && isNonEmptyString(value.key)
}

function isExchangeResult(value: unknown): value is ExchangeResult {
  return isRecord(value) && isNonEmptyString(value.apiKey)
}

function isPayResult(value: unknown): value is PayResult {
  return isRecord(value) && isRecord(value.checkout)
}

function isPartnerCheckoutSession(value: unknown): value is PartnerCheckoutSession {
  if (typeof value !== 'object' || value === null) return false
  const session = value as Record<string, unknown>
  return (
    isNonEmptyString(session.id) &&
    isNonEmptyString(session.sessionToken) &&
    isNonEmptyString(session.partnerId) &&
    typeof session.status === 'string' &&
    PARTNER_CHECKOUT_STATUSES.has(session.status)
  )
}

function isBalanceResult(value: unknown): value is BalanceResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  return (
    typeof result.balance === 'number' &&
    Number.isFinite(result.balance) &&
    typeof result.lowBalance === 'boolean' &&
    typeof result.lowBalanceThreshold === 'number' &&
    Number.isFinite(result.lowBalanceThreshold)
  )
}

class AimlapiResponseTooLargeError extends Error {
  constructor() {
    super(`AI/ML API response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes.`)
    this.name = 'AimlapiResponseTooLargeError'
  }
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Keep the deterministic size-limit error if stream cancellation fails.
        }
        throw new AimlapiResponseTooLargeError()
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

export class AimlapiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'AimlapiApiError'
  }
}

export class AimlapiClient {
  constructor(private readonly endpoints: AimlapiEndpoints) {}

  async checkAccount(email: string, signal?: AbortSignal): Promise<AccountCheckResult> {
    const url = `${this.endpoints.authBaseUrl}/v1/auth/account`
    const result = await this.request<unknown>(url, {
      method: 'PATCH',
      body: { email },
      signal,
    })
    if (!isAccountCheckResult(result)) {
      throw new AimlapiApiError(`PATCH ${requestLabel(url)} returned an invalid account response`, 200, '')
    }
    return result
  }

  async sendSignInCode(email: string, signal?: AbortSignal): Promise<void> {
    await this.request<void>(`${this.endpoints.authBaseUrl}/v1/auth/sign-in/code`, {
      method: 'POST',
      body: { email },
      signal,
      expectJson: false,
    })
  }

  async verifySignInCode(
    email: string,
    code: string,
    signal?: AbortSignal,
  ): Promise<AuthResult> {
    const result = await this.request<unknown>(
      `${this.endpoints.authBaseUrl}/v1/auth/sign-in/code/verify`,
      { method: 'POST', body: { email, code }, signal },
    )
    if (!isAuthResult(result)) throw new Error('AI/ML API did not return an auth token.')
    return result
  }

  async createPasswordlessAccount(email: string, signal?: AbortSignal): Promise<AuthResult> {
    const result = await this.request<unknown>(
      `${this.endpoints.authBaseUrl}/v1/auth/account/passwordless`,
      { method: 'POST', body: { email }, signal },
    )
    if (!isAuthResult(result)) throw new Error('AI/ML API did not return an auth token.')
    return result
  }

  async createKey(
    bearer: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<CreatedKey> {
    const result = await this.request<unknown>(`${this.endpoints.appBaseUrl}/v1/keys`, {
      method: 'POST',
      bearer,
      body: name.trim() ? { name: name.trim() } : {},
      signal,
    })
    if (!isCreatedKey(result)) {
      throw new Error('AI/ML API did not return an API key.')
    }
    return result
  }

  async getBalance(apiKey: string, signal?: AbortSignal): Promise<BalanceResult> {
    const url = `${this.endpoints.inferenceBaseUrl.replace(/\/+$/, '')}/billing/balance`
    const result = await this.request<unknown>(
      url,
      { method: 'GET', bearer: apiKey, signal },
    )
    if (!isBalanceResult(result)) {
      throw new AimlapiApiError(
        `GET ${requestLabel(url)} returned invalid balance response`,
        200,
        '',
      )
    }
    return result
  }

  async createSession(
    input: { partnerId: string; partnerName?: string | null; returnUrl?: string | null },
    signal?: AbortSignal,
  ): Promise<PartnerCheckoutSession> {
    const url = `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions`
    const result = await this.request<unknown>(url, {
      method: 'POST',
      body: {
        partnerId: input.partnerId,
        ...(input.partnerName ? { partnerName: input.partnerName } : {}),
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      },
      signal,
    })
    if (!isPartnerCheckoutSession(result)) {
      throw new AimlapiApiError(`POST ${requestLabel(url)} returned an invalid session`, 200, '')
    }
    return result
  }

  async getSession(
    sessionToken: string,
    signal?: AbortSignal,
  ): Promise<PartnerCheckoutSession> {
    const url = `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}`
    const result = await this.request<unknown>(url, { method: 'GET', signal })
    // A malformed/empty 200 must not read as an unknown status: that would let
    // callers clear the retained payment identity or take an ambiguous retry.
    // Surface it as a non-terminal error so retained state is preserved.
    if (!isPartnerCheckoutSession(result)) {
      throw new AimlapiApiError(`GET ${requestLabel(url)} returned an invalid session`, 200, '')
    }
    return result
  }

  async pay(
    bearer: string,
    sessionToken: string,
    input: {
      amountUsdMinor: number
      paymentSessionId: string
      successUrl?: string
      cancelUrl?: string
      autoTopUp?: boolean
    },
    signal?: AbortSignal,
  ): Promise<PayResult> {
    const url = `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/pay`
    const result = await this.request<unknown>(url, {
      method: 'POST',
      bearer,
      body: {
        amountUsdMinor: input.amountUsdMinor,
        paymentSessionId: input.paymentSessionId,
        method: 'card',
        ...(input.successUrl ? { successUrl: input.successUrl } : {}),
        ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
        ...(input.autoTopUp ? { autoTopUp: true } : {}),
      },
      signal,
    })
    if (!isPayResult(result)) {
      throw new AimlapiApiError(`POST ${requestLabel(url)} returned an invalid checkout`, 200, '')
    }
    return result
  }

  async topUpByKey(
    apiKey: string,
    input: {
      sessionToken: string
      amountUsdMinor: number
      paymentSessionId: string
      successUrl?: string
      cancelUrl?: string
      autoTopUp?: boolean
    },
    signal?: AbortSignal,
  ): Promise<TopUpByKeyResult> {
    const inferenceBase = this.endpoints.inferenceBaseUrl
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/v1$/i, '')
    const url = `${inferenceBase}/v2/billing/topup`
    const result = await this.request<unknown>(url, {
      method: 'POST',
      bearer: apiKey,
      body: {
        sessionToken: input.sessionToken,
        amountUsdMinor: input.amountUsdMinor,
        paymentSessionId: input.paymentSessionId,
        ...(input.successUrl ? { successUrl: input.successUrl } : {}),
        ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
        ...(input.autoTopUp ? { autoTopUp: true } : {}),
      },
      signal,
    })
    if (!isPayResult(result)) {
      throw new AimlapiApiError(`POST ${requestLabel(url)} returned an invalid checkout`, 200, '')
    }
    return result
  }

  async exchange(
    bearer: string,
    sessionToken: string,
    signal?: AbortSignal,
  ): Promise<ExchangeResult> {
    const url = `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/exchange`
    const result = await this.request<unknown>(url, { method: 'POST', bearer, signal })
    if (!isExchangeResult(result)) {
      throw new AimlapiApiError(`POST ${requestLabel(url)} returned an invalid exchange response`, 200, '')
    }
    return result
  }

  private async request<T>(
    url: string,
    options: {
      method: 'GET' | 'POST' | 'PATCH'
      body?: unknown
      bearer?: string
      signal?: AbortSignal
      expectJson?: boolean
    },
  ): Promise<T> {
    const label = requestLabel(url)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.bearer) headers.Authorization = `Bearer ${options.bearer.trim()}`

    const combined = createCombinedAbortSignal(options.signal, {
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
    let response: Response
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        signal: combined.signal,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      })
    } catch (error) {
      combined.cleanup()
      if (options.signal?.aborted) throw error
      const reason = redactRequestSecrets(
        error instanceof Error ? error.message : String(error),
        url,
        options.bearer,
      )
      throw new AimlapiApiError(`Network request to ${label} failed: ${reason}`, 0, '')
    }

    let text: string
    try {
      text = await readResponseText(response)
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (error instanceof AimlapiResponseTooLargeError) {
        throw new AimlapiApiError(
          `${options.method} ${label} response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`,
          response.status,
          '',
        )
      }
      const reason = redactRequestSecrets(
        error instanceof Error ? error.message : String(error),
        url,
        options.bearer,
      )
      throw new AimlapiApiError(`Network response from ${label} failed: ${reason}`, 0, '')
    } finally {
      combined.cleanup()
    }

    if (!response.ok) {
      throw new AimlapiApiError(
        `${options.method} ${label} -> ${response.status}`,
        response.status,
        text,
      )
    }
    if (!text.trim()) {
      if (options.expectJson === false) return undefined as T
      throw new AimlapiApiError(
        `${options.method} ${label} returned empty body`,
        response.status,
        '',
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new AimlapiApiError(
        `${options.method} ${label} returned non-JSON body`,
        response.status,
        text,
      )
    }
    // Every endpoint returns a JSON object. Reject null/non-object bodies here so
    // no method dereferences a null/primitive success payload (which would throw
    // a raw TypeError instead of a controlled, non-terminal error); endpoint
    // guards below still validate structural completeness.
    if (typeof parsed !== 'object' || parsed === null) {
      throw new AimlapiApiError(
        `${options.method} ${label} returned an unexpected body`,
        response.status,
        '',
      )
    }
    return parsed as T
  }
}
