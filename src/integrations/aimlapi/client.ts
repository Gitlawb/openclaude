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
    return this.request<AccountCheckResult>(`${this.endpoints.authBaseUrl}/v1/auth/account`, {
      method: 'PATCH',
      body: { email },
      signal,
    })
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
    const result = await this.request<AuthResult>(
      `${this.endpoints.authBaseUrl}/v1/auth/sign-in/code/verify`,
      { method: 'POST', body: { email, code }, signal },
    )
    if (!result.token?.trim()) throw new Error('AI/ML API did not return an auth token.')
    return result
  }

  async createPasswordlessAccount(email: string, signal?: AbortSignal): Promise<AuthResult> {
    const result = await this.request<AuthResult>(
      `${this.endpoints.authBaseUrl}/v1/auth/account/passwordless`,
      { method: 'POST', body: { email }, signal },
    )
    if (!result.token?.trim()) throw new Error('AI/ML API did not return an auth token.')
    return result
  }

  async createKey(
    bearer: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<CreatedKey> {
    const result = await this.request<CreatedKey>(`${this.endpoints.appBaseUrl}/v1/keys`, {
      method: 'POST',
      bearer,
      body: name.trim() ? { name: name.trim() } : {},
      signal,
    })
    if (!result.key?.trim()) {
      throw new Error('AI/ML API did not return an API key.')
    }
    return result
  }

  async getBalance(apiKey: string, signal?: AbortSignal): Promise<BalanceResult> {
    return this.request<BalanceResult>(
      `${this.endpoints.inferenceBaseUrl.replace(/\/+$/, '')}/billing/balance`,
      { method: 'GET', bearer: apiKey, signal },
    )
  }

  async createSession(
    input: { partnerId: string; partnerName?: string | null; returnUrl?: string | null },
    signal?: AbortSignal,
  ): Promise<PartnerCheckoutSession> {
    return this.request<PartnerCheckoutSession>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions`,
      {
        method: 'POST',
        body: {
          partnerId: input.partnerId,
          ...(input.partnerName ? { partnerName: input.partnerName } : {}),
          ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
        },
        signal,
      },
    )
  }

  async getSession(
    sessionToken: string,
    signal?: AbortSignal,
  ): Promise<PartnerCheckoutSession> {
    return this.request<PartnerCheckoutSession>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}`,
      { method: 'GET', signal },
    )
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
    return this.request<PayResult>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/pay`,
      {
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
      },
    )
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
    return this.request<TopUpByKeyResult>(`${inferenceBase}/v2/billing/topup`, {
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
  }

  async exchange(
    bearer: string,
    sessionToken: string,
    signal?: AbortSignal,
  ): Promise<ExchangeResult> {
    return this.request<ExchangeResult>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/exchange`,
      { method: 'POST', bearer, signal },
    )
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
      const reason = error instanceof Error ? error.message : String(error)
      throw new AimlapiApiError(`Network request to ${url} failed: ${reason}`, 0, '')
    }

    let text: string
    try {
      text = await readResponseText(response)
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (error instanceof AimlapiResponseTooLargeError) {
        throw new AimlapiApiError(
          `${options.method} ${url} response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`,
          response.status,
          '',
        )
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new AimlapiApiError(`Network response from ${url} failed: ${reason}`, 0, '')
    } finally {
      combined.cleanup()
    }

    if (!response.ok) {
      throw new AimlapiApiError(
        `${options.method} ${url} -> ${response.status}`,
        response.status,
        text,
      )
    }
    if (!text.trim()) {
      if (options.expectJson === false) return undefined as T
      throw new AimlapiApiError(
        `${options.method} ${url} returned empty body`,
        response.status,
        '',
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new AimlapiApiError(
        `${options.method} ${url} returned non-JSON body`,
        response.status,
        text,
      )
    }
  }
}
