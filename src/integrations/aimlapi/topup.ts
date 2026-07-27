/**
 * AI/ML API seamless top-up flow.
 *
 * End to end:
 *   1. Log in with AI/ML API credentials      -> Bearer token (held by the CLI)
 *   2. Create a partner-checkout session       -> one-time sessionToken
 *   3. `pay` binds the session + opens a hosted payment page (Stripe / crypto)
 *   4. Open the browser for the user to pay    -> no second login ("auto-login":
 *      the hosted page needs no AI/ML API account, the CLI already holds auth)
 *   5. Poll the session until it is `paid`
 *   6. Exchange the paid session for a raw key (once)
 *   7. Write the key into OpenClaude's provider profile -> the agent now runs
 *      on AI/ML API's OpenAI-compatible endpoint
 *
 * After pay/cancel the provider redirects the browser to the co-branded AI/ML
 * API `/checkout` success / failure screen - see
 * `buildPartnerCheckoutReturnUrls`.
 *
 * Uses the AI/ML API endpoints from config.ts.
 */

import chalk from 'chalk'

import { openBrowser } from '../../utils/browser.js'
import { saveProfileFile } from '../../utils/providerProfile.js'
import {
  AimlapiApiError,
  AimlapiClient,
  type PartnerCheckoutSession,
  type PaymentMethod,
} from './client.js'
import {
  buildPartnerCheckoutReturnUrls,
  DEFAULT_AMOUNT_USD_MINOR,
  DEFAULT_MODEL,
  DEFAULT_PARTNER_ID,
  DEFAULT_PARTNER_NAME,
  MAX_AMOUNT_USD_MINOR,
  MIN_AMOUNT_USD_MINOR,
  resolveEndpoints,
} from './config.js'
import { promptHidden, promptText } from './prompt.js'
import {
  claimAimlapiTopupState,
  clearAimlapiTopupState,
  saveAimlapiTopupState,
  type AimlapiCheckoutState,
  type AimlapiTopupIntent,
} from './topupState.js'

export type AimlapiTopupOptions = {
  email?: string
  password?: string
  /** Top-up amount in whole USD (e.g. "25"). */
  amountUsd?: string
  method?: PaymentMethod
  model?: string
  partnerId?: string
  partnerName?: string
  inviteCode?: string
  /** Skip opening the browser (print the URL instead). */
  noOpen?: boolean
}

export type AimlapiProvisionedKey = {
  apiKey: string
  apiKeyId: string
  baseUrl: string
  model: string
  /**
   * Retire the settled recovery receipt this call left behind. The caller MUST
   * invoke it once it has durably persisted the returned key; until then a
   * second top-up for the same intent short-circuits to this key instead of
   * opening a new checkout. See the contract note on `provisionAimlapiKey`.
   */
  clearReceipt: () => void
}

export type AimlapiTopupStatus =
  | 'registering'
  | 'registered'
  | 'signing-in'
  | 'signed-in'
  | 'creating-session'
  | 'opening-checkout'
  | 'waiting-payment'
  | 'provisioning-key'

export type AimlapiProvisionOptions = AimlapiTopupOptions & {
  onStatus?: (status: AimlapiTopupStatus, detail?: string) => void
}

// Test seam. The unit tests drive both entry points against a stub transport and
// a capturing profile writer by swapping these in, rather than a process-global
// `mock.module('./client.js')`. That mock is not confined to this file: bun's
// module registry is shared across the whole run, so when this suite executes
// before client.test.ts the stub bleeds in and breaks it. Injecting instead of
// mocking keeps the seam local to this module.
type AimlapiClientFactory = (endpoints: ReturnType<typeof resolveEndpoints>) => AimlapiClient
let createAimlapiClient: AimlapiClientFactory = endpoints => new AimlapiClient(endpoints)
let writeAimlapiProviderProfile: typeof saveProfileFile = saveProfileFile

/** Swap in stubs for tests; pass `undefined` to restore the real implementations. */
export function setAimlapiTopupTestDoubles(
  doubles:
    | { createClient?: AimlapiClientFactory; writeProfile?: typeof saveProfileFile }
    | undefined,
): void {
  createAimlapiClient = doubles?.createClient ?? (endpoints => new AimlapiClient(endpoints))
  writeAimlapiProviderProfile = doubles?.writeProfile ?? saveProfileFile
}

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 20 * 60 * 1000 // 20 minutes

// A session the provider reports as `exchanged` has already minted its one-shot
// key; it can never be paid or exchanged again. Both the poll loop and the
// resume path use this so neither opens a second, separately chargeable checkout
// for a credential that is already gone.
const SESSION_ALREADY_EXCHANGED_MESSAGE =
  'Session was already exchanged. The key can only be issued once - rotate it from the AI/ML API dashboard.'

/**
 * Statuses that mean payment has settled, so binding/paying again is wrong and
 * the flow goes straight to the key exchange. `exchanging` is included because
 * `pollUntilPaid` also treats it as ready to exchange.
 */
const PAID_SESSION_STATUSES: ReadonlySet<string> = new Set(['paid', 'exchanging'])

/**
 * A recorded session is worth resuming while it can still reach a paid exchange:
 * the pending states plus the already-settled ones. `exchanged` means the
 * one-shot key was already claimed and the terminal states are dead, so those
 * start a fresh checkout. `exchanging` stays resumable — matching
 * `pollUntilPaid` — so a run interrupted between payment and receipt does not
 * discard the session and open a second, chargeable checkout.
 */
const RESUMABLE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  'pending_auth',
  'pending_payment',
  ...PAID_SESSION_STATUSES,
])

/**
 * Transient HTTP conditions that say nothing about a checkout's fate: a retry or
 * a later resume may still succeed, so they must never retire a recorded session
 * or abort an in-progress payment. status 0 is a network-level failure (see
 * client.ts); 408/429 are request-timeout/rate-limit; 5xx are server-side.
 */
function isTransientHttpError(error: unknown): boolean {
  return (
    error instanceof AimlapiApiError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500)
  )
}

function buildTopupIntent(args: {
  email: string
  amountUsdMinor: number
  partnerId: string
  partnerName: string
  appBaseUrl: string
  inferenceBaseUrl: string
}): AimlapiTopupIntent {
  return {
    email: args.email,
    amountUsdMinor: args.amountUsdMinor,
    // The password flow has no auto-top-up toggle; it is part of the intent so a
    // later flow that does offer it cannot adopt this checkout by accident.
    autoTopUp: false,
    partnerId: args.partnerId,
    partnerName: args.partnerName,
    appBaseUrl: args.appBaseUrl,
    inferenceBaseUrl: args.inferenceBaseUrl,
  }
}

/**
 * Reuse the checkout recorded for this exact intent when it can still be paid,
 * so a run interrupted after the payment page opened resumes that session rather
 * than opening — and charging — a second one.
 */
async function resolveCheckoutSession(
  client: AimlapiClient,
  args: {
    intent: AimlapiTopupIntent
    state: AimlapiCheckoutState
    partnerId: string
    partnerName: string
  },
): Promise<{ session: PartnerCheckoutSession; state: AimlapiCheckoutState }> {
  const { intent, partnerId, partnerName } = args
  let state = args.state

  if (state.resumeSessionToken) {
    let existing: PartnerCheckoutSession | undefined
    try {
      existing = await client.getSession(state.resumeSessionToken)
    } catch (error) {
      // Only a definitive answer may retire the recorded checkout. Preserve it
      // (surface the error, so a re-run resumes) when the failure says nothing
      // about the session's fate:
      //   - transient conditions: network blip, timeout, rate-limit, 5xx;
      //   - a malformed-but-successful body — client.getSession throws
      //     AimlapiApiError(..., 200) for that, explicitly as a non-terminal
      //     signal so retained state is preserved.
      // Discarding here would open — and charge — a second checkout for a
      // still-payable one. `pollUntilPaid` draws the same line.
      if (
        isTransientHttpError(error) ||
        (error instanceof AimlapiApiError && error.status === 200)
      ) {
        throw error
      }
      // A definitive read failure (e.g. 404/410 for a genuinely gone session):
      // fall through and open a fresh checkout.
    }
    if (existing) {
      if (RESUMABLE_SESSION_STATUSES.has(existing.status)) {
        return { session: existing, state }
      }
      if (existing.status === 'exchanged') {
        // The one-shot key was already issued for this session, but no settled
        // receipt survived locally (the caller's settled-receipt shortcut has
        // already run). Opening a fresh checkout would charge again for a key we
        // cannot re-mint, so fail closed exactly like `pollUntilPaid` instead of
        // minting a second checkout.
        throw new Error(SESSION_ALREADY_EXCHANGED_MESSAGE)
      }
      // Any other terminal status (cancelled/expired/failed) is a dead session:
      // fall through and open a fresh checkout.
    }
    // The recorded session cannot be paid anymore. Drop it and claim a new
    // payment identity so the next attempt is not tied to the dead one.
    clearAimlapiTopupState({ ...intent, paymentSessionId: state.paymentSessionId })
    state = claimAimlapiTopupState(intent)
  }

  const session = await client.createSession({ partnerId, partnerName })
  const next: AimlapiCheckoutState = {
    ...state,
    resumeSessionToken: session.sessionToken,
  }
  // Record it before the browser opens: an interruption from here on resumes
  // this session instead of starting another checkout. A lost compare-and-swap
  // means another run owns the slot, so this attempt has no resume record and
  // must not proceed to charge.
  if (!saveAimlapiTopupState({ ...intent, ...next })) {
    throw new Error(
      'Another AI/ML API checkout claimed this top-up. Re-run to continue that one.',
    )
  }
  return { session, state: next }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function maskKey(key: string): string {
  if (key.length <= 10) {
    return '****'
  }
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

/**
 * Write the issued key into the provider profile, drop the now-spent recovery
 * record, and report success. Shared by the normal exchange path and the
 * settled-receipt resume so both retire the record only after the profile write.
 */
function finishCliTopup(args: {
  intent: AimlapiTopupIntent
  paymentSessionId: string
  apiKey: string
  apiKeyId: string
  model: string
  baseUrl: string
}): void {
  const profilePath = writeAimlapiProviderProfile({
    profile: 'openai',
    env: {
      OPENAI_BASE_URL: args.baseUrl,
      OPENAI_API_KEY: args.apiKey,
      OPENAI_MODEL: args.model,
    },
    createdAt: new Date().toISOString(),
  })
  // The credential is now in the profile, so the recovery record is spent.
  clearAimlapiTopupState({ ...args.intent, paymentSessionId: args.paymentSessionId })

  console.log(chalk.green(`\n  [OK] Balance topped up and provider configured.`))
  console.log(`    key      ${chalk.dim(maskKey(args.apiKey))}  (id ${args.apiKeyId})`)
  console.log(`    base URL ${chalk.dim(args.baseUrl)}`)
  console.log(`    model    ${chalk.dim(args.model)}`)
  console.log(`    profile  ${chalk.dim(profilePath)}`)
  console.log(chalk.dim(`\n  Run ${chalk.bold('openclaude')} to start coding on AI/ML API.\n`))
}

function parseAmount(amountUsd: string | undefined): number {
  if (!amountUsd) {
    return DEFAULT_AMOUNT_USD_MINOR
  }
  const dollars = Number(amountUsd)
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error(`Invalid amount: "${amountUsd}". Pass a positive number of USD.`)
  }
  const minor = Math.round(dollars * 100)
  if (minor < MIN_AMOUNT_USD_MINOR) {
    throw new Error(`Minimum top-up is $${MIN_AMOUNT_USD_MINOR / 100}.`)
  }
  if (minor > MAX_AMOUNT_USD_MINOR) {
    throw new Error(`Maximum top-up is $${MAX_AMOUNT_USD_MINOR / 100}.`)
  }
  return minor
}

function describeAimlapiAuthError(error: unknown): string {
  if (error instanceof AimlapiApiError) {
    const body = error.body.trim()
    return body
      ? `HTTP ${error.status}: ${body}`
      : `HTTP ${error.status}: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

async function authenticateAimlapiAccount(
  client: AimlapiClient,
  options: {
    email: string
    password: string
    inviteCode?: string
    onStatus?: (status: AimlapiTopupStatus, detail?: string) => void
  },
): Promise<string> {
  let signupError: unknown
  try {
    options.onStatus?.('registering')
    const { token } = await client.signup({
      email: options.email,
      password: options.password,
      inviteCode: options.inviteCode,
    })
    options.onStatus?.('registered')
    return token
  } catch (error) {
    signupError = error
  }

  try {
    options.onStatus?.('signing-in')
    const { token } = await client.login(options.email, options.password)
    options.onStatus?.('signed-in')
    return token
  } catch (loginError) {
    throw new Error(
      `Could not register or log in to AI/ML API. Registration: ${describeAimlapiAuthError(signupError)}. Login: ${describeAimlapiAuthError(loginError)}.`,
    )
  }
}

export async function runAimlapiTopup(options: AimlapiTopupOptions): Promise<void> {
  const endpoints = resolveEndpoints()
  const client = createAimlapiClient(endpoints)

  const partnerId = options.partnerId?.trim() || process.env.AIMLAPI_PARTNER_ID?.trim() || DEFAULT_PARTNER_ID
  const partnerName = options.partnerName?.trim() || DEFAULT_PARTNER_NAME
  const method: PaymentMethod = options.method === 'crypto' ? 'crypto' : 'card'
  const model = options.model?.trim() || DEFAULT_MODEL
  const amountUsdMinor = parseAmount(options.amountUsd)

  console.log(
    chalk.bold(`\n  AI/ML API top-up`) +
      chalk.dim(`  -  ${endpoints.appBaseUrl}\n`),
  )

  // 1. Credentials -> Bearer token.
  const email = options.email?.trim() || process.env.AIMLAPI_EMAIL?.trim() || (await promptText('AI/ML API email'))
  const password = options.password || process.env.AIMLAPI_PASSWORD || (await promptHidden('AI/ML API password'))
  if (!email || !password) {
    throw new Error('Email and password are required.')
  }

  console.log(chalk.dim('  -> Signing in...'))
  const token = await authenticateAimlapiAccount(client, {
    email,
    password,
    inviteCode: options.inviteCode || process.env.AIMLAPI_INVITE_CODE,
  })
  console.log(chalk.green('  [OK] Signed in'))

  // 2. Partner-checkout session, resuming the one recorded for this intent when
  // a previous run was interrupted after payment started.
  const intent = buildTopupIntent({
    email,
    amountUsdMinor,
    partnerId,
    partnerName,
    appBaseUrl: endpoints.appBaseUrl,
    inferenceBaseUrl: endpoints.inferenceBaseUrl,
  })
  const checkoutState = claimAimlapiTopupState(intent)
  // A previous run already exchanged the key but was interrupted before (or
  // during) the profile write. Resume from the receipt instead of resolving a
  // checkout: the provider now reports that session as `exchanged`, so going
  // through resolveCheckoutSession would discard the receipt and open — and
  // charge — a brand-new checkout for a key we already paid for.
  if (checkoutState.settled && checkoutState.apiKey) {
    console.log(chalk.dim('  -> Resuming a previously provisioned key'))
    finishCliTopup({
      intent,
      paymentSessionId: checkoutState.paymentSessionId,
      apiKey: checkoutState.apiKey,
      apiKeyId: checkoutState.apiKeyId ?? '',
      model: checkoutState.model?.trim() || model,
      baseUrl: endpoints.inferenceBaseUrl,
    })
    return
  }
  const { session, state } = await resolveCheckoutSession(client, {
    intent,
    state: checkoutState,
    partnerId,
    partnerName,
  })
  console.log(chalk.dim(`  -> Session ${session.id}`))

  // 3. Bind + open hosted payment page, unless we resumed a session that is
  // already paid — re-binding a settled checkout has no defined behaviour, so go
  // straight to the exchange.
  let paid: PartnerCheckoutSession
  if (PAID_SESSION_STATUSES.has(session.status)) {
    console.log(chalk.dim('  -> Payment already completed; resuming'))
    paid = session
  } else {
    const { successUrl, cancelUrl } = buildPartnerCheckoutReturnUrls(
      endpoints.appBaseUrl,
      session.sessionToken,
    )
    const { checkout } = await client.pay(token, session.sessionToken, {
      amountUsdMinor,
      method,
      // The persisted payment id is the charge idempotency key: a retry or an
      // ambiguous /pay result must reference the same identity, not open a
      // second charge.
      paymentSessionId: state.paymentSessionId,
      successUrl,
      cancelUrl,
    })
    if (!checkout.payUrl) {
      throw new Error('Payment provider did not return a checkout URL.')
    }

    console.log(
      chalk.bold(`\n  Pay $${(amountUsdMinor / 100).toFixed(2)} (${method}) to top up:\n`) +
        `  ${chalk.cyan(checkout.payUrl)}\n`,
    )
    if (options.noOpen) {
      console.log(chalk.dim('  (open the link above to complete payment)'))
    } else {
      const opened = await openBrowser(checkout.payUrl)
      if (!opened) {
        console.log(chalk.dim('  (could not auto-open a browser - open the link above manually)'))
      }
    }

    // 4./5. Poll until paid.
    console.log(chalk.dim('\n  Waiting for payment...'))
    paid = await pollUntilPaid(client, session.sessionToken)
  }

  // 6. Exchange the paid session for the raw key (once).
  console.log(chalk.dim('  -> Provisioning API key...'))
  const { apiKey, apiKeyId } = await client.exchange(token, paid.sessionToken)
  // The exchange is one-shot: record the issued key before touching the profile
  // so an interruption here does not strand a paid-for credential. A lost
  // compare-and-swap means the receipt was NOT stored, so say so loudly with the
  // key in hand rather than continuing as if recovery were possible.
  if (
    !saveAimlapiTopupState({
      ...intent,
      ...state,
      apiKey,
      apiKeyId,
      model,
      settled: true,
    })
  ) {
    console.log(
      chalk.yellow(
        `\n  [warn] Could not record the recovery receipt for the issued key ${maskKey(apiKey)} (id ${apiKeyId}).` +
          `\n         If the profile write below also fails, this key cannot be recovered —` +
          `\n         rotate it from the AI/ML API dashboard.`,
      ),
    )
  }

  // 7. Persist into OpenClaude's provider profile and retire the record.
  finishCliTopup({
    intent,
    paymentSessionId: state.paymentSessionId,
    apiKey,
    apiKeyId,
    model,
    baseUrl: endpoints.inferenceBaseUrl,
  })
}

/**
 * Provision a key for the guided (GUI) flow and return it in memory.
 *
 * Recovery-receipt contract: this function does not own the persistence of the
 * returned key, so it never clears the checkout record itself. On success it
 * leaves a settled receipt behind and returns a `clearReceipt` closure; the
 * caller MUST call it once it has durably saved the key. Until then the receipt
 * is the only recoverable copy, and a second top-up for the same intent will
 * short-circuit and return the recorded key instead of charging again — so
 * calling `clearReceipt` after a successful persist is required for a later
 * top-up to actually open a new checkout.
 */
export async function provisionAimlapiKey(
  options: AimlapiProvisionOptions,
): Promise<AimlapiProvisionedKey> {
  const endpoints = resolveEndpoints()
  const client = createAimlapiClient(endpoints)

  const partnerId =
    options.partnerId?.trim() ||
    process.env.AIMLAPI_PARTNER_ID?.trim() ||
    DEFAULT_PARTNER_ID
  const partnerName = options.partnerName?.trim() || DEFAULT_PARTNER_NAME
  const method: PaymentMethod = options.method === 'crypto' ? 'crypto' : 'card'
  const model = options.model?.trim() || DEFAULT_MODEL
  const amountUsdMinor = parseAmount(options.amountUsd)

  const email =
    options.email?.trim() ||
    process.env.AIMLAPI_EMAIL?.trim() ||
    (await promptText('AI/ML API email'))
  const password =
    options.password ||
    process.env.AIMLAPI_PASSWORD ||
    (await promptHidden('AI/ML API password'))
  if (!email || !password) {
    throw new Error('Email and password are required.')
  }

  const token = await authenticateAimlapiAccount(client, {
    email,
    password,
    inviteCode: options.inviteCode || process.env.AIMLAPI_INVITE_CODE,
    onStatus: options.onStatus,
  })

  // Resume the checkout recorded for this intent when a previous run was
  // interrupted after payment started, instead of opening a second one.
  const intent = buildTopupIntent({
    email,
    amountUsdMinor,
    partnerId,
    partnerName,
    appBaseUrl: endpoints.appBaseUrl,
    inferenceBaseUrl: endpoints.inferenceBaseUrl,
  })
  // Bind the receipt-clear to the intent so the caller can retire it without
  // reconstructing the checkout identity itself.
  const clearReceiptFor = (paymentSessionId: string) => (): void =>
    clearAimlapiTopupState({ ...intent, paymentSessionId })

  const claimed = claimAimlapiTopupState(intent)
  // A previous run already exchanged the key but was interrupted before the
  // caller persisted it: hand back that credential instead of paying again.
  // The receipt is NOT cleared here — the key is returned only in memory, and
  // clearing before the caller has persisted it would drop the sole recoverable
  // copy if that persistence then fails. The caller clears it (via
  // clearAimlapiTopupState) once its own write succeeds; see the contract note
  // on this function.
  if (claimed.settled && claimed.apiKey) {
    return {
      apiKey: claimed.apiKey,
      apiKeyId: claimed.apiKeyId ?? '',
      baseUrl: endpoints.inferenceBaseUrl,
      model: claimed.model?.trim() || model,
      clearReceipt: clearReceiptFor(claimed.paymentSessionId),
    }
  }

  options.onStatus?.('creating-session')
  const { session, state } = await resolveCheckoutSession(client, {
    intent,
    state: claimed,
    partnerId,
    partnerName,
  })

  // A resumed session that is already paid must not be re-bound: go straight to
  // the exchange instead of calling pay() on a settled checkout.
  let paid: PartnerCheckoutSession
  if (PAID_SESSION_STATUSES.has(session.status)) {
    paid = session
  } else {
    options.onStatus?.('opening-checkout')
    const { successUrl, cancelUrl } = buildPartnerCheckoutReturnUrls(
      endpoints.appBaseUrl,
      session.sessionToken,
    )
    const { checkout } = await client.pay(token, session.sessionToken, {
      amountUsdMinor,
      method,
      // The persisted payment id is the charge idempotency key: a retry or an
      // ambiguous /pay result must reference the same identity, not open a
      // second charge.
      paymentSessionId: state.paymentSessionId,
      successUrl,
      cancelUrl,
    })
    if (!checkout.payUrl) {
      throw new Error('Payment provider did not return a checkout URL.')
    }

    if (options.noOpen) {
      options.onStatus?.('opening-checkout', checkout.payUrl)
    } else {
      const opened = await openBrowser(checkout.payUrl)
      options.onStatus?.(
        'opening-checkout',
        opened ? checkout.payUrl : `Open manually: ${checkout.payUrl}`,
      )
    }

    options.onStatus?.('waiting-payment')
    paid = await pollUntilPaid(client, session.sessionToken)
  }

  options.onStatus?.('provisioning-key')
  const { apiKey, apiKeyId } = await client.exchange(token, paid.sessionToken)
  // The exchange is one-shot and the key is only handed back in memory, so keep
  // a settled receipt rather than clearing here: an interruption before the
  // caller persists it would otherwise lose a paid-for credential permanently.
  // The receipt is consumed by the shortcut above on the next run, and the
  // caller clears it once its own persistence succeeds.
  if (
    !saveAimlapiTopupState({
      ...intent,
      ...state,
      apiKey,
      apiKeyId,
      model,
      settled: true,
    })
  ) {
    // Another run claimed the slot, so the receipt was NOT stored and the
    // shortcut above cannot recover this key. The caller is now the only thing
    // between a paid-for credential and permanent loss — say so rather than
    // returning as if recovery were still possible.
    options.onStatus?.(
      'provisioning-key',
      `Could not record the recovery receipt for the issued key (id ${apiKeyId}); persist it immediately.`,
    )
  }

  return {
    apiKey,
    apiKeyId,
    baseUrl: endpoints.inferenceBaseUrl,
    model,
    clearReceipt: clearReceiptFor(state.paymentSessionId),
  }
}

async function pollUntilPaid(
  client: AimlapiClient,
  sessionToken: string,
): Promise<PartnerCheckoutSession> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    let session: PartnerCheckoutSession
    try {
      session = await client.getSession(sessionToken)
    } catch (error) {
      // Transient poll failures (network, timeout, rate-limit, 5xx) shouldn't
      // abort a payment in progress.
      if (isTransientHttpError(error)) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }
      throw error
    }

    switch (session.status) {
      case 'paid':
      case 'exchanging':
        return session
      case 'exchanged':
        throw new Error(SESSION_ALREADY_EXCHANGED_MESSAGE)
      case 'cancelled':
      case 'expired':
      case 'failed':
        throw new Error(`Payment ${session.status}. Re-run the top-up to try again.`)
      default:
        // pending_auth / pending_payment -> keep waiting.
        await sleep(POLL_INTERVAL_MS)
    }
  }
  throw new Error('Timed out waiting for payment. Re-run once the payment clears.')
}
