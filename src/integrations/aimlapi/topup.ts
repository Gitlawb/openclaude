/**
 * AI/ML API passwordless onboarding and partner-checkout orchestration.
 *
 * End to end:
 *   1. Resolve the account email and check the account          -> sign-in | sign-up
 *   2. Sign in with a 6-digit email code, or create a new account -> access (Bearer) token
 *   3. Reuse a retained existing-account key, or mint one (sign-in) / exchange one (sign-up)
 *   4. Create a partner-checkout session and open the hosted payment page
 *   5. Poll the session until it is paid, then exchange the paid session for the key
 *   6. Write the key into OpenClaude's provider profile and retire the record
 *
 * Checkout crosses the browser/terminal boundary, so the payment session and
 * payment identity are retained (see topupState.ts) to make retries, cancellation
 * and exchange idempotent and resumable.
 */

import chalk from 'chalk'

import { openBrowser } from '../../utils/browser.js'
import { saveProfileFile } from '../../utils/providerProfile.js'
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
  isCanonicalAimlapiInferenceBaseUrl,
  resolveEndpoints,
  resolvePartnerId,
} from './config.js'
import { promptHidden, promptText } from './prompt.js'
import {
  claimAimlapiTopupState,
  clearAimlapiTopupState,
  recordAimlapiCheckoutSession,
  resetAimlapiCheckoutSession,
  saveAimlapiTopupState,
  type AimlapiTopupIntent,
} from './topupState.js'
import { isValidAimlapiEmail, parseAimlapiAmountUsd } from './validation.js'

export type AimlapiTopupOptions = {
  email?: string
  /** 6-digit email sign-in code (else prompted / `AIMLAPI_CODE`). */
  code?: string
  /** Top-up amount in whole USD (e.g. "25"). */
  amountUsd?: string
  autoTopUp?: boolean
  model?: string
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
  /** Access (Bearer) token from sign-in / account creation. */
  sessionToken: string
  /** Endpoint that validated an existing key and must own any key-bound billing. */
  inferenceBaseUrl?: string
  /** Exchange the paid session for a fresh key (sign-up), else reuse the passed key. */
  exchange: boolean
  existingApiKey?: string
  existingApiKeyId?: string
  resumeSessionToken?: string
  /** Stable idempotency handle retained for one amount/auto-top-up intent. */
  paymentSessionId: string
  /** Persist the session token; returns the elected token when a peer won. */
  onSession?: (sessionToken: string) => string | void
  onStatus?: (status: AimlapiTopupStatus, detail?: string) => void
}

export type AimlapiByKeyTopupOptions = Omit<AimlapiTopupOptions, 'email' | 'code'> & {
  apiKey: string
  inferenceBaseUrl?: string
  paymentSessionId: string
  resumeSessionToken?: string
  /** Persist the session token; returns the elected token when a peer won. */
  onSession?: (sessionToken: string) => string | void
  onStatus?: (status: AimlapiTopupStatus, detail?: string) => void
}

type TopupPhase = 'pay' | 'poll' | 'exchange' | 'wait-exchange'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 20 * 60 * 1000

// Test seam. The unit tests drive the flow against a stub transport and a
// capturing profile writer by swapping these in, rather than a process-global
// `mock.module('./client.js')` — that mock is not confined to one file (bun's
// module registry is shared across the whole run), so it would bleed into
// client.test.ts. Injecting keeps the seam local to this module.
type AimlapiClientFactory = (endpoints: ReturnType<typeof resolveEndpoints>) => AimlapiClient
let createAimlapiClient: AimlapiClientFactory = endpoints => new AimlapiClient(endpoints)
let writeAimlapiProviderProfile: typeof saveProfileFile = saveProfileFile
let promptTextFn: typeof promptText = promptText
let promptHiddenFn: typeof promptHidden = promptHidden

/** Swap in stubs for tests; pass `undefined` to restore the real implementations. */
export function setAimlapiTopupTestDoubles(
  doubles:
    | {
        createClient?: AimlapiClientFactory
        writeProfile?: typeof saveProfileFile
        promptText?: typeof promptText
        promptHidden?: typeof promptHidden
      }
    | undefined,
): void {
  createAimlapiClient = doubles?.createClient ?? (endpoints => new AimlapiClient(endpoints))
  writeAimlapiProviderProfile = doubles?.writeProfile ?? saveProfileFile
  promptTextFn = doubles?.promptText ?? promptText
  promptHiddenFn = doubles?.promptHidden ?? promptHidden
}

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

// A session the provider reports as `exchanged` has already minted its one-shot
// key; it can never be paid or exchanged again. Both the poll loop and the
// resume path use this so neither opens a second, separately chargeable checkout
// for a credential that is already gone.
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
  const client = createAimlapiClient(endpoints)
  const email =
    options.email?.trim() ||
    process.env.AIMLAPI_EMAIL?.trim() ||
    (await promptTextFn('AI/ML API email'))
  if (!isValidAimlapiEmail(email)) throw new Error('Email format is incorrect.')

  // Guided provisioning mints/exchanges a production-account key via production
  // auth and writes it as OPENAI_BASE_URL. Refuse a non-canonical inference
  // override so a freshly minted key is never sent to a custom/proxy endpoint
  // (mirrors the provider-manager gate).
  if (!isCanonicalAimlapiInferenceBaseUrl(endpoints.inferenceBaseUrl)) {
    throw new Error(
      'Guided top-up requires the aimlapi.com production endpoint. Unset AIMLAPI_INFERENCE_URL to create or fund a key.',
    )
  }

  console.log(chalk.bold('\n  AI/ML API top-up') + chalk.dim(`  -  ${endpoints.appBaseUrl}\n`))

  // Validate the amount and claim (or reuse) the retained checkout before any
  // account lookup or key mint: an invalid amount must not strand an unused key,
  // and an interrupted checkout must resume on the same key rather than mint a
  // fresh one on every retry.
  const amountUsdMinor = parseAimlapiAmountUsd(options.amountUsd)
  const partnerId = resolvePartnerId()
  const partnerName = DEFAULT_PARTNER_NAME
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

  const finishProfile = (provisioned: AimlapiProvisionedKey): void => {
    const profilePath = writeAimlapiProviderProfile({
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
    clearAimlapiTopupState({ ...intent, paymentSessionId: checkoutState.paymentSessionId })
    console.log(chalk.green('\n  [OK] Balance topped up and provider configured.'))
    console.log(`    key      ${chalk.dim(maskKey(provisioned.apiKey))}  (id ${provisioned.apiKeyId})`)
    console.log(`    base URL ${chalk.dim(provisioned.baseUrl)}`)
    console.log(`    model    ${chalk.dim(provisioned.model)}`)
    console.log(`    profile  ${chalk.dim(profilePath)}`)
  }

  // Resume: a prior run provisioned the key but was interrupted before the
  // profile write. Finish that last step with the retained key instead of
  // re-provisioning a now-exchanged (otherwise stranded) session. This runs
  // BEFORE any account lookup, so a re-authentication prompt or auth outage can
  // never strand a paid-for key that is already recorded locally.
  if (checkoutState.settled && checkoutState.apiKey) {
    finishProfile({
      apiKey: checkoutState.apiKey,
      apiKeyId: checkoutState.apiKeyId ?? '',
      baseUrl: endpoints.inferenceBaseUrl,
      // Prefer the model captured when the key was provisioned; a retry with a
      // different --model must not silently reconfigure the settled profile.
      model: checkoutState.model?.trim() || options.model?.trim() || DEFAULT_MODEL,
    })
    return
  }

  console.log(chalk.dim('  -> Checking account...'))
  const account = await client.checkAccount(email, options.signal)
  const persistSession = (resumeSessionToken: string): string | undefined => {
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
        return undefined
      }
      clearAimlapiTopupState({
        ...intent,
        paymentSessionId: checkoutState.paymentSessionId,
      })
      return undefined
    }
    // Atomic election: the first run to record a session for this payment id
    // wins; a loser gets the winner's token back and adopts it, so concurrent
    // runs never leave two chargeable checkouts.
    const recorded = recordAimlapiCheckoutSession({
      ...intent,
      ...checkoutState,
      resumeSessionToken,
    })
    if (!recorded) {
      // A null result means the stored checkout was cleared/reset meanwhile — a
      // sibling run already completed (or invalidated) this exact top-up. Abort
      // rather than pay a second, unrecorded checkout for a completed top-up.
      throw new Error(
        'This top-up was already completed or cancelled elsewhere. Re-run to try again.',
      )
    }
    const elected = recorded.resumeSessionToken || resumeSessionToken
    checkoutState.resumeSessionToken = elected
    return elected
  }

  let sessionToken: string
  let apiKey = checkoutState.apiKey?.trim() ?? ''
  let apiKeyId = checkoutState.apiKeyId?.trim() ?? ''
  let exchange: boolean

  switch (account.action) {
    case 'sign-in': {
      console.log(chalk.dim('  -> Sending sign-in code...'))
      await client.sendSignInCode(email, options.signal)
      const code =
        options.code?.trim() ||
        process.env.AIMLAPI_CODE?.trim() ||
        (await promptHiddenFn(`6-digit code sent to ${email}`))
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
      console.log(chalk.dim('  -> Creating account...'))
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
      if (status === 'opening-checkout' && detail) {
        console.log(
          chalk.bold(`\n  Pay $${(amountUsdMinor / 100).toFixed(2)} to top up:\n`) +
            `  ${chalk.cyan(detail)}\n`,
        )
      }
      if (status === 'waiting-payment') console.log(chalk.dim('  Waiting for payment...'))
    },
  })

  // Persist the provisioned key (and its model) as recoverable before the
  // profile write, so an interruption or a failed write resumes the write
  // instead of stranding a paid, one-shot-exchanged key.
  checkoutState.apiKey = provisioned.apiKey
  checkoutState.apiKeyId = provisioned.apiKeyId
  checkoutState.model = provisioned.model
  checkoutState.settled = true
  saveAimlapiTopupState({ ...intent, ...checkoutState })

  finishProfile(provisioned)
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
  const client = createAimlapiClient(endpoints)
  const amountUsdMinor = parseAimlapiAmountUsd(options.amountUsd)
  const partnerId = resolvePartnerId()
  const partnerName = DEFAULT_PARTNER_NAME

  options.onStatus?.('creating-session')
  const { sessionToken, phase } = await resolveTopupSession(client, {
    resumeSessionToken: options.resumeSessionToken,
    partnerId,
    partnerName,
    verificationBaseUrl: endpoints.verificationBaseUrl,
    signal: options.signal,
    onSession: options.onSession,
  })
  // The session token is persisted inside resolveTopupSession as part of the
  // atomic election, so there is no separate onSession call here.

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
    await announceCheckout(checkout?.payUrl, options)
  }

  let paidToken = sessionToken
  let settledPhase = phase
  if (phase === 'pay' || phase === 'poll') {
    options.onStatus?.('waiting-payment')
    const paid = await pollUntilPaid(client, sessionToken, options.signal, options.onSession)
    paidToken = paid.sessionToken
    if (paid.status === 'exchanging') settledPhase = 'wait-exchange'
  }
  let apiKey = options.existingApiKey?.trim() || ''
  let apiKeyId = options.existingApiKeyId?.trim() || ''
  if (options.exchange) {
    options.onStatus?.('provisioning-key')
    if (settledPhase === 'wait-exchange') {
      await pollUntilExchangeSettled(client, sessionToken, options.signal, options.onSession)
    }
    const exchanged = await client.exchange(options.sessionToken, paidToken, options.signal)
    apiKey = exchanged.apiKey.trim()
    apiKeyId = exchanged.apiKeyId.trim()
  } else if (settledPhase === 'wait-exchange') {
    // A resumed sign-in top-up was still crediting the account balance. Wait for
    // it to settle before reporting success, otherwise the caller marks the
    // balance credited while the billing operation is still in flight (mirrors
    // topUpAimlapiByApiKey's resume path).
    options.onStatus?.('waiting-payment')
    await pollUntilByKeyToppedUp(client, sessionToken, options.signal, options.onSession)
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
  const client = createAimlapiClient(endpoints)
  const amountUsdMinor = parseAimlapiAmountUsd(options.amountUsd)
  const partnerId = resolvePartnerId()
  const partnerName = DEFAULT_PARTNER_NAME

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
  // The session token is persisted inside resolveTopupSession as part of the
  // atomic election, so there is no separate onSession call here.

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
    await announceCheckout(checkout?.payUrl, options)
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
  payUrl: string | null | undefined,
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
  // Surface the validated checkout URL before attempting to open a browser: a
  // launcher failure (e.g. on a headless host) must not hide an already-created
  // checkout, or the user cannot finish paying and retries only re-poll.
  options.onStatus?.('opening-checkout', checkoutUrl)
  if (!options.noOpen) {
    try {
      await openBrowser(checkoutUrl)
    } catch {
      // The URL is already surfaced; a failed launch must not abort payment.
    }
  }
}

async function resolveTopupSession(
  client: AimlapiClient,
  options: {
    resumeSessionToken?: string
    partnerId: string
    partnerName: string
    verificationBaseUrl: string
    signal?: AbortSignal
    onSession?: (sessionToken: string) => string | void
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
    // Atomic election happens as the session is recorded: if a peer already
    // opened a payable checkout for this payment id, adopt its token and resume
    // that session instead of leaving this freshly created one chargeable too.
    const elected = options.onSession?.(session.sessionToken)
    if (elected && elected !== session.sessionToken) {
      return resolveTopupSession(client, { ...options, resumeSessionToken: elected })
    }
    return { sessionToken: session.sessionToken, phase: 'pay' }
  }
  let session: PartnerCheckoutSession
  try {
    session = await client.getSession(resume, options.signal)
  } catch (error) {
    if (isTerminalSessionApiError(error)) options.onSession?.('')
    throw error
  }
  let phase: TopupPhase
  switch (session.status) {
    case 'pending_auth':
      phase = 'pay'
      break
    case 'pending_payment':
      phase = 'poll'
      break
    case 'paid':
      phase = 'exchange'
      break
    case 'exchanging':
      // Not settled yet for either flow: the account flow must wait then
      // exchange, the by-key flow must wait for the top-up to finish crediting.
      phase = 'wait-exchange'
      break
    case 'exchanged':
      if (!options.byKey) throw alreadyExchangedError(session)
      phase = 'exchange'
      break
    default:
      options.onSession?.('')
      throw new Error(`Payment ${session.status}. Re-run the top-up to try again.`)
  }
  // Re-notify the resumed token so the caller keeps its in-memory + on-disk copy
  // in sync (idempotent: the election keeps the already-recorded token).
  options.onSession?.(resume)
  return { sessionToken: resume, phase }
}

async function pollUntilExchangeSettled(
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
      if (session.status === 'exchanged') throw alreadyExchangedError(session)
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
      if (session.status !== 'exchanging') return
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
  throw new Error('Timed out waiting for key provisioning. Retry to check the same session.')
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

// A 4xx that is not a rate-limit/timeout is a definitive answer about the
// session (gone / forbidden / bad request), so it retires the recorded checkout
// rather than being retried.
function isTerminalSessionApiError(error: unknown): boolean {
  return (
    error instanceof AimlapiApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    !isRetryableSessionApiError(error)
  )
}

// Transient transport failures (network, timeout, rate-limit, 5xx) say nothing
// about the session's fate, so polling retries them instead of aborting.
function isRetryableSessionApiError(error: unknown): boolean {
  return (
    error instanceof AimlapiApiError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500)
  )
}
