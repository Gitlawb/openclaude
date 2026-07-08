/**
 * AI/ML API partner-checkout HTTP client.
 *
 * Talks to two services:
 *   - app/auth   (`authBaseUrl`)  - `POST /v1/auth/account` (signup) /
 *                                   `PUT /v1/auth/account` (login) -> Bearer token
 *   - app/gateway(`appBaseUrl`)   - `/v3/partner-checkout/*`
 *
 * Uses the global `fetch` (Node >= 22). All error bodies are surfaced verbatim
 * so failures are debuggable.
 */

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

export type ExchangeResult = {
  apiKey: string
  apiKeyId: string
}

export type PaymentMethod = 'card' | 'crypto'
export type AuthResult = { token: string; exp: number }

const REQUEST_TIMEOUT_MS = 30_000

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

  /** Register a new AI/ML API account -> access (Bearer) token. */
  async signup(input: {
    email: string
    password: string
    inviteCode?: string
  }): Promise<AuthResult> {
    return this.request<AuthResult>(
      `${this.endpoints.authBaseUrl}/v1/auth/account`,
      {
        method: 'POST',
        body: {
          email: input.email,
          password: input.password,
          ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
        },
      },
    )
  }

  /** Sign in with email + password -> access (Bearer) token. */
  async login(email: string, password: string): Promise<AuthResult> {
    return this.request<AuthResult>(
      `${this.endpoints.authBaseUrl}/v1/auth/account`,
      { method: 'PUT', body: { email, password } },
    )
  }

  /** Create a partner-checkout session (public - no auth). */
  async createSession(input: {
    partnerId: string
    partnerName?: string | null
    returnUrl?: string | null
  }): Promise<PartnerCheckoutSession> {
    return this.request<PartnerCheckoutSession>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions`,
      {
        method: 'POST',
        body: {
          partnerId: input.partnerId,
          ...(input.partnerName ? { partnerName: input.partnerName } : {}),
          ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
        },
      },
    )
  }

  /** Poll a session by its one-time token (public - no auth). */
  async getSession(sessionToken: string): Promise<PartnerCheckoutSession> {
    return this.request<PartnerCheckoutSession>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}`,
      { method: 'GET' },
    )
  }

  /**
   * Bind the session to the logged-in user and open a hosted payment page.
   * Requires the Bearer token. Returns `checkout.payUrl` to open in a browser.
   *
   * `successUrl`/`cancelUrl` are the co-branded `/checkout` return URLs the
   * payment provider redirects the browser to after pay/cancel (see
   * `buildPartnerCheckoutReturnUrls`). When omitted the backend falls back to a
   * bare, non-co-branded `/checkout?checkout=success`.
   */
  async pay(
    bearer: string,
    sessionToken: string,
    input: {
      amountUsdMinor: number
      method: PaymentMethod
      successUrl?: string
      cancelUrl?: string
    },
  ): Promise<PayResult> {
    return this.request<PayResult>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/pay`,
      {
        method: 'POST',
        bearer,
        body: {
          amountUsdMinor: input.amountUsdMinor,
          method: input.method,
          ...(input.successUrl ? { successUrl: input.successUrl } : {}),
          ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
        },
      },
    )
  }

  /**
   * Exchange a PAID session for the raw CLI key. One-shot: a second call after
   * a successful exchange loses the claim and returns no key. Requires Bearer.
   */
  async exchange(bearer: string, sessionToken: string): Promise<ExchangeResult> {
    return this.request<ExchangeResult>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/exchange`,
      { method: 'POST', bearer },
    )
  }

  private async request<T>(
    url: string,
    options: {
      method: 'GET' | 'POST' | 'PUT'
      body?: unknown
      bearer?: string
    },
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (options.bearer) {
      headers.Authorization = `Bearer ${options.bearer}`
    }

    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: REQUEST_TIMEOUT_MS,
    })

    let response: Response
    let text: string
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        signal,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      })
      text = await response.text()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new AimlapiApiError(`Network request to ${url} failed: ${reason}`, 0, '')
    } finally {
      cleanup()
    }

    if (!response.ok) {
      throw new AimlapiApiError(
        `${options.method} ${url} -> ${response.status}`,
        response.status,
        text,
      )
    }

    if (!text) {
      return undefined as T
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
