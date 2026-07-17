/** AI/ML API passwordless onboarding and partner-checkout orchestration. */

import chalk from 'chalk'

import {
  AimlapiApiError,
  AimlapiClient,
  type PartnerCheckoutSession,
} from './client.js'
import {
  buildPartnerCheckoutReturnUrls,
  buildPartnerReturnUrl,
  DEFAULT_MODEL,
  DEFAULT_PARTNER_NAME,
  resolveEndpoints,
  resolvePartnerId,
} from './config.js'
import { openBrowser, promptText, saveProfileFile } from './topupDependencies.js'
import {
  claimAimlapiTopupState,
  clearAimlapiTopupState,
  resetAimlapiCheckoutSession,
  saveAimlapiTopupState,
  type AimlapiTopupIntent,
} from './topupState.js'
import { isValidAimlapiEmail, parseAimlapiAmountUsd } from './validation.js'

export type AimlapiTopupOptions = {
  email?: string
  code?: string
  /** Top-up amount in whole USD (e.g. "25"). */
  amountUsd?: string
  autoTopUp?: boolean
  model?: string
  partnerId?: string
  partnerName?: string
  /** Skip opening the browser (print the URL instead). */
  noOpen?: boolean
  signal?: AbortSignal
}

export type AimlapiProvisionedKey = {
  apiKey: string
  apiKeyId: string
  baseUrl: string
  model: string
}

export type AimlapiTopupStatus =
  | 'checking-account'
  | 'sending-code'
  | 'verifying-code'
  | 'creating-account'
  | 'creating-key'
  | 'creating-session'
  | 'opening-checkout'
  | 'waiting-payment'
  | 'provisioning-key'

export type AimlapiProvisionOptions = Omit<AimlapiTopupOptions, 'email' | 'code'> & {
  sessionToken: string
  /** Endpoint that validated an existing key and must own any key-bound billing. */
  inferenceBaseUrl?: string
  exchange: boolean
  existingApiKey?: string
  existingApiKeyId?: string
  resumeSessionToken?: string
  /** Stable idempotency handle retained for one amount/auto-top-up intent. */
  paymentSessionId: string
  onSession?: (sessionToken: string) => void
  onStatus?: (status: AimlapiTopupStatus, detail?: string) => void
}

export type AimlapiByKeyTopupOptions = Omit<AimlapiTopupOptions, 'email' | 'code'> & {
  apiKey: string
  inferenceBaseUrl?: string
  paymentSessionId: string
  resumeSessionToken?: string
  onSession?: (sessionToken: string) => void
  onStatus?: (status: AimlapiTopupStatus, detail?: string) => void
}

type TopupPhase = 'pay' | 'poll' | 'exchange' | 'wait-exchange'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 20 * 60 * 1000

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      cleanup()
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function maskKey(key: string): string {
  return key.length <= 10 ? '****' : `${key.slice(0, 6)}...${key.slice(-4)}`
}

function alreadyExchangedError(session: PartnerCheckoutSession): Error {
  const keyHint = session.issuedKeyId?.trim()
    ? ` for issued key ${session.issuedKeyId.trim()}`
    : ''
  return new Error(
    `Session was already exchanged${keyHint}. Open https://aimlapi.com/app and rotate the issued key to recover access.`,
  )
}

export async function runAimlapiTopup(options: AimlapiTopupOptions): Promise<void> {
  const endpoints = resolveEndpoints()
  const client = new AimlapiClient(endpoints)
  const email =
    options.email?.trim() ||
    process.env.AIMLAPI_EMAIL?.trim() ||
    (await promptText('AI/ML API email'))
  if (!isValidAimlapiEmail(email)) throw new Error('Email format is incorrect.')

  console.log(chalk.bold('\n  AI/ML API top-up') + chalk.dim(`  -  ${endpoints.appBaseUrl}\n`))
  const account = await client.checkAccount(email, options.signal)

  // Validate the amount and claim (or reuse) the retained checkout before
  // minting any credential: an invalid amount must not strand an unused key,
  // and an interrupted checkout must resume on the same key rather than mint a
  // fresh one on every retry.
  const amountUsdMinor = parseAimlapiAmountUsd(options.amountUsd)
  const partnerId = resolvePartnerId(options.partnerId)
  const partnerName = options.partnerName?.trim() || DEFAULT_PARTNER_NAME
  const intent: AimlapiTopupIntent = {
    email: email.toLowerCase(),
    amountUsdMinor,
    autoTopUp: options.autoTopUp === true,
    partnerId,
    partnerName,
    appBaseUrl: endpoints.appBaseUrl.trim().replace(/\/+$/, ''),
    inferenceBaseUrl: endpoints.inferenceBaseUrl.trim().replace(/\/+$/, ''),
    payBaseUrl: endpoints.payBaseUrl.trim().replace(/\/+$/, ''),
    verificationBaseUrl: endpoints.verificationBaseUrl.trim().replace(/\/+$/, ''),
  }
  const checkoutState = claimAimlapiTopupState(intent)
  const persistSession = (resumeSessionToken: string): void => {
    if (!resumeSessionToken) {
      // A terminal checkout invalidates the payment session, but a minted
      // existing-account key is still valid: retain it (with a fresh payment
      // session) so the next run reuses the credential instead of issuing
      // another. Fall back to a full clear when there is no key to keep.
      if (
        checkoutState.apiKey &&
        resetAimlapiCheckoutSession({
          ...intent,
          paymentSessionId: checkoutState.paymentSessionId,
        })
      ) {
        return
      }
      clearAimlapiTopupState({
        ...intent,
        paymentSessionId: checkoutState.paymentSessionId,
      })
      return
    }
    checkoutState.resumeSessionToken = resumeSessionToken
    saveAimlapiTopupState({ ...intent, ...checkoutState })
  }

  let sessionToken: string
  let apiKey = checkoutState.apiKey?.trim() ?? ''
  let apiKeyId = checkoutState.apiKeyId?.trim() ?? ''
  let exchange: boolean

  switch (account.action) {
    case 'sign-in': {
      await client.sendSignInCode(email, options.signal)
      const code =
        options.code?.trim() ||
        process.env.AIMLAPI_CODE?.trim() ||
        (await promptText('6-digit code', { mask: true }))
      if (!code) throw new Error('Sign-in code is required.')
      sessionToken = (await client.verifySignInCode(email, code, options.signal)).token
      if (!apiKey) {
        const created = await client.createKey(sessionToken, 'OpenClaude CLI', options.signal)
        apiKey = created.key
        apiKeyId = created.id
        // Retain the issued key with the intent so a retry after an interrupted
        // checkout reuses it instead of minting another.
        checkoutState.apiKey = apiKey
        checkoutState.apiKeyId = apiKeyId
        saveAimlapiTopupState({ ...intent, ...checkoutState })
      }
      exchange = false
      break
    }
    case 'sign-up': {
      sessionToken = (await client.createPasswordlessAccount(email, options.signal)).token
      exchange = true
      break
    }
    default:
      // Fail closed: only the two account actions the flow understands may
      // proceed (mirrors the guided onboarding path).
      throw new Error('AI/ML API returned an unsupported account action.')
  }

  const provisioned = await provisionAimlapiKey({
    amountUsd: options.amountUsd,
    autoTopUp: options.autoTopUp,
    model: options.model,
    partnerId,
    partnerName,
    noOpen: options.noOpen,
    signal: options.signal,
    sessionToken,
    exchange,
    paymentSessionId: checkoutState.paymentSessionId,
    resumeSessionToken: checkoutState.resumeSessionToken,
    existingApiKey: apiKey,
    existingApiKeyId: apiKeyId,
    onSession: persistSession,
    onStatus: (status, detail) => {
      if (status === 'opening-checkout' && detail) console.log(`  ${chalk.cyan(detail)}`)
      if (status === 'waiting-payment') console.log(chalk.dim('  Waiting for payment...'))
    },
  })

  const profilePath = saveProfileFile({
    profile: 'openai',
    env: {
      OPENAI_BASE_URL: provisioned.baseUrl,
      OPENAI_API_KEY: provisioned.apiKey,
      AIMLAPI_API_KEY: provisioned.apiKey,
      OPENAI_MODEL: provisioned.model,
      CLAUDE_CODE_PROVIDER_ROUTE_ID: 'aimlapi',
    },
    createdAt: new Date().toISOString(),
  })
  clearAimlapiTopupState({
    ...intent,
    paymentSessionId: checkoutState.paymentSessionId,
  })

  console.log(chalk.green('\n  [OK] Balance topped up and provider configured.'))
  console.log(`    key      ${chalk.dim(maskKey(provisioned.apiKey))}  (id ${provisioned.apiKeyId})`)
  console.log(`    base URL ${chalk.dim(provisioned.baseUrl)}`)
  console.log(`    model    ${chalk.dim(provisioned.model)}`)
  console.log(`    profile  ${chalk.dim(profilePath)}`)
}

export async function provisionAimlapiKey(
  options: AimlapiProvisionOptions,
): Promise<AimlapiProvisionedKey> {
  if (!options.sessionToken.trim()) throw new Error('A session is required to top up.')
  if (!options.paymentSessionId?.trim()) {
    throw new Error('A payment session id is required to top up.')
  }
  const endpoints = resolveEndpoints()
  if (options.inferenceBaseUrl?.trim()) {
    endpoints.inferenceBaseUrl = options.inferenceBaseUrl.trim()
  }
  const client = new AimlapiClient(endpoints)
  const amountUsdMinor = parseAimlapiAmountUsd(options.amountUsd)
  const partnerId = resolvePartnerId(options.partnerId)
  const partnerName = options.partnerName?.trim() || DEFAULT_PARTNER_NAME

  options.onStatus?.('creating-session')
  const { sessionToken, phase } = await resolveTopupSession(client, {
    resumeSessionToken: options.resumeSessionToken,
    partnerId,
    partnerName,
    verificationBaseUrl: endpoints.verificationBaseUrl,
    signal: options.signal,
    onSession: options.onSession,
  })
  options.onSession?.(sessionToken)

  if (phase === 'pay') {
    const returnUrls = buildPartnerCheckoutReturnUrls(endpoints.payBaseUrl, sessionToken)
    options.onStatus?.('opening-checkout')
    const { checkout } = await client.pay(
      options.sessionToken,
      sessionToken,
      {
        amountUsdMinor,
        paymentSessionId: options.paymentSessionId,
        ...returnUrls,
        autoTopUp: options.autoTopUp,
      },
      options.signal,
    )
    await announceCheckout(checkout.payUrl, options)
  }

  let paidToken = sessionToken
  let settledPhase = phase
  if (phase === 'pay' || phase === 'poll') {
    options.onStatus?.('waiting-payment')
    const paid = await pollUntilPaid(
      client,
      sessionToken,
      options.signal,
      options.onSession,
    )
    paidToken = paid.sessionToken
    if (paid.status === 'exchanging') settledPhase = 'wait-exchange'
  }
  let apiKey = options.existingApiKey?.trim() || ''
  let apiKeyId = options.existingApiKeyId?.trim() || ''
  if (options.exchange) {
    options.onStatus?.('provisioning-key')
    if (settledPhase === 'wait-exchange') {
      await pollUntilExchangeSettled(
        client,
        sessionToken,
        options.signal,
        options.onSession,
      )
    }
    const exchanged = await client.exchange(
      options.sessionToken,
      paidToken,
      options.signal,
    )
    apiKey = exchanged.apiKey?.trim()
    apiKeyId = exchanged.apiKeyId?.trim()
  }
  if (!apiKey) throw new Error('AI/ML API did not return an API key.')

  return {
    apiKey,
    apiKeyId,
    baseUrl: endpoints.inferenceBaseUrl,
    model: options.model?.trim() || DEFAULT_MODEL,
  }
}

export async function topUpAimlapiByApiKey(
  options: AimlapiByKeyTopupOptions,
): Promise<AimlapiProvisionedKey> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('An API key is required to top up.')
  if (!options.paymentSessionId.trim()) {
    throw new Error('A payment session id is required to top up.')
  }
  const endpoints = resolveEndpoints()
  if (options.inferenceBaseUrl?.trim()) {
    endpoints.inferenceBaseUrl = options.inferenceBaseUrl.trim()
  }
  const client = new AimlapiClient(endpoints)
  const amountUsdMinor = parseAimlapiAmountUsd(options.amountUsd)
  const partnerId = resolvePartnerId(options.partnerId)
  const partnerName = options.partnerName?.trim() || DEFAULT_PARTNER_NAME

  options.onStatus?.('creating-session')
  const { sessionToken, phase } = await resolveTopupSession(client, {
    resumeSessionToken: options.resumeSessionToken,
    partnerId,
    partnerName,
    verificationBaseUrl: endpoints.verificationBaseUrl,
    signal: options.signal,
    onSession: options.onSession,
    byKey: true,
  })
  options.onSession?.(sessionToken)

  if (phase === 'pay') {
    const returnUrls = buildPartnerCheckoutReturnUrls(endpoints.payBaseUrl, sessionToken)
    options.onStatus?.('opening-checkout')
    const { checkout } = await client.topUpByKey(
      apiKey,
      {
        sessionToken,
        amountUsdMinor,
        paymentSessionId: options.paymentSessionId,
        ...returnUrls,
        autoTopUp: options.autoTopUp,
      },
      options.signal,
    )
    await announceCheckout(checkout.payUrl, options)
  }
  if (phase === 'pay' || phase === 'poll') {
    options.onStatus?.('waiting-payment')
    const paid = await pollUntilPaid(client, sessionToken, options.signal, options.onSession)
    if (paid.status === 'exchanging') {
      await pollUntilByKeyToppedUp(client, sessionToken, options.signal, options.onSession)
    }
  } else if (phase === 'wait-exchange') {
    // A resumed session was still settling the top-up; wait for it to reach a
    // terminal state before reporting success, otherwise the caller marks the
    // balance credited while the billing operation is still in flight.
    options.onStatus?.('waiting-payment')
    await pollUntilByKeyToppedUp(client, sessionToken, options.signal, options.onSession)
  }

  return {
    apiKey,
    apiKeyId: '',
    baseUrl: endpoints.inferenceBaseUrl,
    model: options.model?.trim() || DEFAULT_MODEL,
  }
}

async function announceCheckout(
  payUrl: string | null,
  options: Pick<AimlapiTopupOptions, 'noOpen'> & {
    onStatus?: (status: AimlapiTopupStatus, detail?: string) => void
  },
): Promise<void> {
  const checkoutUrl = payUrl?.trim()
  if (!checkoutUrl) throw new Error('Payment provider did not return a valid HTTPS checkout URL.')
  let parsed: URL
  try {
    parsed = new URL(checkoutUrl)
  } catch {
    throw new Error('Payment provider did not return a valid HTTPS checkout URL.')
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new Error('Payment provider did not return a valid HTTPS checkout URL.')
  }
  if (!options.noOpen) await openBrowser(checkoutUrl)
  options.onStatus?.('opening-checkout', checkoutUrl)
}

async function resolveTopupSession(
  client: AimlapiClient,
  options: {
    resumeSessionToken?: string
    partnerId: string
    partnerName: string
    verificationBaseUrl: string
    signal?: AbortSignal
    onSession?: (sessionToken: string) => void
    byKey?: boolean
  },
): Promise<{ sessionToken: string; phase: TopupPhase }> {
  const resume = options.resumeSessionToken?.trim()
  if (!resume) {
    const session = await client.createSession(
      {
        partnerId: options.partnerId,
        partnerName: options.partnerName,
        returnUrl: buildPartnerReturnUrl(options.verificationBaseUrl),
      },
      options.signal,
    )
    return { sessionToken: session.sessionToken, phase: 'pay' }
  }
  let session: PartnerCheckoutSession
  try {
    session = await client.getSession(resume, options.signal)
  } catch (error) {
    if (isTerminalSessionApiError(error)) options.onSession?.('')
    throw error
  }
  switch (session.status) {
    case 'pending_auth':
      return { sessionToken: resume, phase: 'pay' }
    case 'pending_payment':
      return { sessionToken: resume, phase: 'poll' }
    case 'paid':
      return { sessionToken: resume, phase: 'exchange' }
    case 'exchanging':
      // Not settled yet for either flow: the account flow must wait then
      // exchange, the by-key flow must wait for the top-up to finish crediting.
      return { sessionToken: resume, phase: 'wait-exchange' }
    case 'exchanged':
      if (options.byKey) return { sessionToken: resume, phase: 'exchange' }
      throw alreadyExchangedError(session)
    default:
      options.onSession?.('')
      throw new Error(`Payment ${session.status}. Re-run the top-up to try again.`)
  }
}

async function pollUntilExchangeSettled(
  client: AimlapiClient,
  sessionToken: string,
  signal?: AbortSignal,
  onSession?: (sessionToken: string) => void,
): Promise<never> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError(signal)
    try {
      const session = await client.getSession(sessionToken, signal)
      if (session.status === 'exchanged') {
        throw alreadyExchangedError(session)
      }
      if (
        session.status === 'cancelled' ||
        session.status === 'expired' ||
        session.status === 'failed'
      ) {
        onSession?.('')
        throw new Error(
          `Key provisioning ${session.status}. Rotate the key from the AI/ML API dashboard.`,
        )
      }
      if (session.status !== 'exchanging') {
        throw new Error(
          `Key provisioning returned to ${session.status}. Re-run the top-up.`,
        )
      }
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      if (isRetryableSessionApiError(error)) {
        await sleep(POLL_INTERVAL_MS, signal)
        continue
      }
      if (isTerminalSessionApiError(error)) onSession?.('')
      throw error
    }
    await sleep(POLL_INTERVAL_MS, signal)
  }
  throw new Error(
    'Timed out waiting for key provisioning. Retry to check the same session.',
  )
}

async function pollUntilByKeyToppedUp(
  client: AimlapiClient,
  sessionToken: string,
  signal?: AbortSignal,
  onSession?: (sessionToken: string) => void,
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError(signal)
    try {
      const session = await client.getSession(sessionToken, signal)
      switch (session.status) {
        case 'paid':
        case 'exchanged':
          return
        case 'cancelled':
        case 'expired':
        case 'failed':
          onSession?.('')
          throw new Error(`Top-up ${session.status}. Re-run the top-up to try again.`)
        default:
          // pending_* / exchanging -> keep waiting for the balance to settle.
          await sleep(POLL_INTERVAL_MS, signal)
      }
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      if (isRetryableSessionApiError(error)) {
        await sleep(POLL_INTERVAL_MS, signal)
        continue
      }
      if (isTerminalSessionApiError(error)) onSession?.('')
      throw error
    }
  }
  throw new Error('Timed out waiting for the top-up to settle. Re-run once it clears.')
}

export async function pollUntilPaid(
  client: AimlapiClient,
  sessionToken: string,
  signal?: AbortSignal,
  onSession?: (sessionToken: string) => void,
): Promise<PartnerCheckoutSession> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError(signal)
    try {
      const session = await client.getSession(sessionToken, signal)
      switch (session.status) {
        case 'paid':
        case 'exchanging':
          return session
        case 'exchanged':
          throw alreadyExchangedError(session)
        case 'cancelled':
        case 'expired':
        case 'failed':
          onSession?.('')
          throw new Error(`Payment ${session.status}. Re-run the top-up to try again.`)
        default:
          await sleep(POLL_INTERVAL_MS, signal)
      }
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      if (isRetryableSessionApiError(error)) {
        await sleep(POLL_INTERVAL_MS, signal)
        continue
      }
      if (isTerminalSessionApiError(error)) onSession?.('')
      throw error
    }
  }
  throw new Error('Timed out waiting for payment. Re-run once the payment clears.')
}

function isTerminalSessionApiError(error: unknown): boolean {
  return (
    error instanceof AimlapiApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    !isRetryableSessionApiError(error)
  )
}

function isRetryableSessionApiError(error: unknown): boolean {
  return (
    error instanceof AimlapiApiError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500)
  )
}
