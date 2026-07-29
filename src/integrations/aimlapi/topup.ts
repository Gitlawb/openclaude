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

import { randomUUID } from 'node:crypto'

import chalk from 'chalk'

import { openBrowser } from '../../utils/browser.js'
import { logForDebugging } from '../../utils/debug.js'
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
  acquireAimlapiExchangeLeaseAsync,
  claimAimlapiTopupStateAsync,
  clearAimlapiTopupStateAsync,
  loadAimlapiTopupState,
  recordAimlapiCheckoutSessionAsync,
  releaseAimlapiExchangeLeaseAsync,
  saveAimlapiTopupStateAsync,
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
   * Resolves once the receipt is cleared (it acquires the checkout-state lock).
   */
  clearReceipt: () => Promise<void>
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
  method: PaymentMethod
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
    // The payment rail is bound into the checkout via the reused payment id, so a
    // card→crypto (or reverse) restart must open its own checkout, not adopt the
    // prior one and reuse its idempotency identity.
    method: args.method,
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
      // Only a DEFINITIVE "the session is gone" answer may retire the recorded
      // checkout. Preserve it (surface the error, so a re-run resumes) for
      // anything else — a transient blip/timeout/rate-limit/5xx, a malformed-
      // but-successful body (AimlapiApiError status 200, a non-terminal signal),
      // or an ambiguous failure such as auth/4xx. Discarding on those would open
      // — and charge — a second checkout for a still-payable one. Only 404/410
      // mean the session no longer exists; `pollUntilPaid` never retires either.
      const sessionIsGone =
        error instanceof AimlapiApiError &&
        (error.status === 404 || error.status === 410)
      if (!sessionIsGone) {
        throw error
      }
      // Fall through: the recorded session is gone, so open a fresh checkout.
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
    await clearAimlapiTopupStateAsync({
      ...intent,
      paymentSessionId: state.paymentSessionId,
    })
    state = await claimAimlapiTopupStateAsync(intent)
  }

  const session = await client.createSession({ partnerId, partnerName })
  const next: AimlapiCheckoutState = {
    ...state,
    resumeSessionToken: session.sessionToken,
  }
  // Record it before the browser opens, as a compare-and-swap on the resume
  // token still being empty. Two runs racing the same intent converge on one
  // payment id (see claimAimlapiTopupState) and can each open a session before
  // either records one; the CAS makes the first writer win. A null result means
  // the slot no longer belongs to this run at all (a reset/clear happened), so
  // it must not proceed to charge.
  const recorded = await recordAimlapiCheckoutSessionAsync({ ...intent, ...next })
  if (!recorded) {
    throw new Error(
      'Another AI/ML API checkout claimed this top-up. Re-run to continue that one.',
    )
  }
  if (recorded.resumeSessionToken !== session.sessionToken) {
    // A peer recorded its session first. Adopt it and abandon the one we just
    // opened (it is unpaid and never shown) so both runs settle on a single
    // payable checkout instead of charging twice; pay() is idempotent on the
    // shared payment id, so converging here cannot double-charge. Re-validate
    // its live status the same way the initial resume does — a peer session that
    // reached a terminal state in the race window must fail cleanly, not have
    // pay() called on a dead session.
    const adopted = await client.getSession(recorded.resumeSessionToken)
    if (RESUMABLE_SESSION_STATUSES.has(adopted.status)) {
      return { session: adopted, state: recorded }
    }
    if (adopted.status === 'exchanged') {
      throw new Error(SESSION_ALREADY_EXCHANGED_MESSAGE)
    }
    // The adopted session is dead too. The slot holds the peer's token, so a
    // re-run resumes it, sees the terminal status, and opens a fresh checkout;
    // surface that instead of paying a dead session.
    throw new Error(
      'Another AI/ML API checkout claimed this top-up and its session is no longer payable. Re-run to continue.',
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
async function finishCliTopup(args: {
  intent: AimlapiTopupIntent
  paymentSessionId: string
  apiKey: string
  apiKeyId: string
  model: string
  baseUrl: string
}): Promise<void> {
  const profilePath = writeAimlapiProviderProfile({
    profile: 'openai',
    env: {
      OPENAI_BASE_URL: args.baseUrl,
      OPENAI_API_KEY: args.apiKey,
      OPENAI_MODEL: args.model,
    },
    createdAt: new Date().toISOString(),
  })
  // The credential is now in the profile, so the recovery record is spent. This
  // is cleanup AFTER delivery: a clear failure (lock timeout / fs / corrupt
  // state) must not fail an otherwise-successful top-up — the stranded receipt is
  // retired on the next run.
  try {
    await clearAimlapiTopupStateAsync({
      ...args.intent,
      paymentSessionId: args.paymentSessionId,
    })
  } catch (error) {
    logForDebugging(`Failed to clear the AI/ML API recovery receipt: ${error}`, {
      level: 'warn',
    })
    // Surface it to the user too (not just --debug): a stranded receipt blocks a
    // later different-amount/email top-up, and `aimlapi reset` is the escape
    // hatch — mirroring the GUI warning.
    console.log(
      chalk.yellow(
        '\n  [warn] Could not clear the aimlapi.com recovery receipt. Run ' +
          '`openclaude aimlapi reset` before starting a different top-up.',
      ),
    )
  }

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

/**
 * Record the settled recovery receipt for a just-exchanged key, reporting only
 * whether it landed. The exchange is one-shot, so this MUST NOT abort the flow:
 * a false compare-and-swap OR a thrown lock-timeout / filesystem error both mean
 * the receipt was not stored, but the key is in hand and the caller still has to
 * deliver it (write the profile / return the key). Swallow the error here — the
 * caller warns off the boolean — rather than stranding a paid-for credential in
 * an already-exchanged session that can never be re-issued.
 */
async function recordSettledReceipt(args: {
  intent: AimlapiTopupIntent
  state: AimlapiCheckoutState
  apiKey: string
  apiKeyId: string
  model: string
}): Promise<boolean> {
  try {
    return await saveAimlapiTopupStateAsync({
      ...args.intent,
      ...args.state,
      apiKey: args.apiKey,
      apiKeyId: args.apiKeyId,
      model: args.model,
      settled: true,
    })
  } catch (error) {
    logForDebugging(`Failed to record the AI/ML API recovery receipt: ${error}`, {
      level: 'warn',
    })
    return false
  }
}

// The one-shot exchange is serialized across racing same-intent processes by an
// exchange lease: only the elected holder calls exchange, so exactly one key is
// minted and recorded. A peer that loses the election waits briefly for the
// winner's settled receipt and resumes from it. A lease left by a crashed holder
// goes stale and is reclaimed on a later attempt. The wait deadline bounds how
// long a loser blocks in-line; past it, it defers to a re-run (which recovers via
// the settled receipt) rather than exchanging in parallel.
const EXCHANGE_WAIT_TIMEOUT_MS = 10_000
const EXCHANGE_WAIT_POLL_MS = 250

type LeasedExchange = {
  apiKey: string
  apiKeyId: string
  /** Whether the settled recovery receipt is on disk (minted here, or by a peer). */
  recorded: boolean
  /** True when the key came from a peer's settled receipt rather than our exchange. */
  resumed: boolean
}

/**
 * Perform the one-shot key exchange under an exchange lease so at most one of N
 * racing same-intent processes mints the (non-idempotent) key. The winner
 * exchanges and records a settled receipt; a loser resumes from that receipt. On
 * a failed exchange the lease is released so a retry is not blocked for the full
 * stale window.
 */
async function exchangeLeasedKey(args: {
  client: AimlapiClient
  token: string
  intent: AimlapiTopupIntent
  state: AimlapiCheckoutState
  sessionToken: string
  model: string
  onWaiting?: () => void
}): Promise<LeasedExchange> {
  const { client, token, intent, state, sessionToken, model } = args
  const expected = { ...intent, paymentSessionId: state.paymentSessionId }
  // A per-attempt owner id: `pid` alone is not unique across restarts, and two
  // in-process callers (tests, or a retried flow) must not alias one lease.
  const owner = `${process.pid}-${randomUUID()}`
  const deadline = Date.now() + EXCHANGE_WAIT_TIMEOUT_MS
  for (;;) {
    const lease = await acquireAimlapiExchangeLeaseAsync(expected, owner)
    if (lease.status === 'gone') {
      throw new Error(
        'The AI/ML API checkout was reset while the key was being provisioned. ' +
          'Re-run the top-up.',
      )
    }
    if (lease.status === 'settled') {
      // A peer minted and recorded the key first — resume from its receipt
      // instead of exchanging the (now spent) session.
      return {
        apiKey: lease.state.apiKey ?? '',
        apiKeyId: lease.state.apiKeyId ?? '',
        recorded: true,
        resumed: true,
      }
    }
    if (lease.status === 'acquired') {
      let exchanged: { apiKey: string; apiKeyId: string }
      try {
        exchanged = await client.exchange(token, sessionToken)
      } catch (error) {
        // The key was not delivered to us: drop our lease so a retry (or a
        // waiting peer) can proceed at once instead of blocking for the whole
        // stale window. If the provider did mint before the failure, the retry
        // hits an already-exchanged session and fails closed — no double mint.
        try {
          await releaseAimlapiExchangeLeaseAsync(expected, owner)
        } catch {
          // Best-effort; the lease self-expires once it goes stale.
        }
        throw error
      }
      const recorded = await recordSettledReceipt({
        intent,
        state,
        apiKey: exchanged.apiKey,
        apiKeyId: exchanged.apiKeyId,
        model,
      })
      return {
        apiKey: exchanged.apiKey,
        apiKeyId: exchanged.apiKeyId,
        recorded,
        resumed: false,
      }
    }
    // lease.status === 'held': a live peer holds a fresh lease and is exchanging.
    // Wait, then resume from its settled receipt on the next iteration.
    if (Date.now() >= deadline) {
      throw new Error(
        'Another AI/ML API top-up for this account is finishing right now. Wait a ' +
          'moment and re-run — the issued key will be picked up automatically.',
      )
    }
    args.onWaiting?.()
    await sleep(EXCHANGE_WAIT_POLL_MS)
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

  // 1. Resolve the account email — enough to identify the stored checkout — and
  // recover a settled receipt BEFORE authenticating. A run interrupted after the
  // one-shot exchange but before the profile write leaves the paid-for key in
  // that receipt; requiring a fresh login to reach it would strand the key
  // whenever the password has since changed or the auth service is unavailable.
  const email = options.email?.trim() || process.env.AIMLAPI_EMAIL?.trim() || (await promptText('AI/ML API email'))
  if (!email) {
    throw new Error('Email is required.')
  }

  const intent = buildTopupIntent({
    email,
    amountUsdMinor,
    method,
    partnerId,
    partnerName,
    appBaseUrl: endpoints.appBaseUrl,
    inferenceBaseUrl: endpoints.inferenceBaseUrl,
  })
  // A previous run already exchanged the key but was interrupted before (or
  // during) the profile write. Resume from the receipt instead of resolving a
  // checkout: the provider now reports that session as `exchanged`, so going
  // through resolveCheckoutSession would discard the receipt and open — and
  // charge — a brand-new checkout for a key we already paid for. This read is
  // side-effect free, so it needs no login.
  const recovered = loadAimlapiTopupState(intent)
  if (recovered?.settled && recovered.apiKey) {
    console.log(chalk.dim('  -> Resuming a previously provisioned key'))
    await finishCliTopup({
      intent,
      paymentSessionId: recovered.paymentSessionId,
      apiKey: recovered.apiKey,
      apiKeyId: recovered.apiKeyId ?? '',
      model: recovered.model?.trim() || model,
      baseUrl: endpoints.inferenceBaseUrl,
    })
    return
  }

  // 2. No deliverable receipt: this run must create/resume and exchange a
  // checkout, which needs a Bearer token. Prompt for the password now and sign in.
  const password = options.password || process.env.AIMLAPI_PASSWORD || (await promptHidden('AI/ML API password'))
  if (!password) {
    throw new Error('Password is required.')
  }

  console.log(chalk.dim('  -> Signing in...'))
  const token = await authenticateAimlapiAccount(client, {
    email,
    password,
    inviteCode: options.inviteCode || process.env.AIMLAPI_INVITE_CODE,
  })
  console.log(chalk.green('  [OK] Signed in'))

  // 3. Partner-checkout session, resuming the one recorded for this intent when
  // a previous run was interrupted after payment started.
  const checkoutState = await claimAimlapiTopupStateAsync(intent)
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

  // 6. Exchange the paid session for the raw key (once) — serialized so racing
  // same-intent processes cannot both mint the one-shot key. The settled receipt
  // is recorded before the profile write so an interruption here does not strand
  // a paid-for credential; a failed record must NOT abort the flow (the profile
  // write below is the primary delivery), so warn with the key in hand instead.
  console.log(chalk.dim('  -> Provisioning API key...'))
  const { apiKey, apiKeyId, recorded } = await exchangeLeasedKey({
    client,
    token,
    intent,
    state,
    sessionToken: paid.sessionToken,
    model,
    onWaiting: () =>
      console.log(
        chalk.dim('  -> Another session is finishing this checkout; waiting...'),
      ),
  })
  if (!recorded) {
    console.log(
      chalk.yellow(
        `\n  [warn] Could not record the recovery receipt for the issued key ${maskKey(apiKey)} (id ${apiKeyId}).` +
          `\n         If the profile write below also fails, this key cannot be recovered —` +
          `\n         rotate it from the AI/ML API dashboard.`,
      ),
    )
  }

  // 7. Persist into OpenClaude's provider profile and retire the record.
  await finishCliTopup({
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
  if (!email) {
    throw new Error('Email is required.')
  }

  // Resume the checkout recorded for this intent when a previous run was
  // interrupted after payment started, instead of opening a second one.
  const intent = buildTopupIntent({
    email,
    amountUsdMinor,
    method,
    partnerId,
    partnerName,
    appBaseUrl: endpoints.appBaseUrl,
    inferenceBaseUrl: endpoints.inferenceBaseUrl,
  })
  // Bind the receipt-clear to the intent so the caller can retire it without
  // reconstructing the checkout identity itself.
  const clearReceiptFor = (paymentSessionId: string) => (): Promise<void> =>
    clearAimlapiTopupStateAsync({ ...intent, paymentSessionId })

  // A previous run already exchanged the key but was interrupted before the
  // caller persisted it: hand back that credential instead of paying again —
  // and BEFORE authenticating, so a changed password or an auth-service outage
  // cannot strand the paid-for key. The receipt is NOT cleared here — the key is
  // returned only in memory, and clearing before the caller has persisted it
  // would drop the sole recoverable copy if that persistence then fails. The
  // caller clears it (via clearAimlapiTopupState) once its own write succeeds;
  // see the contract note on this function. This read is side-effect free.
  const recovered = loadAimlapiTopupState(intent)
  if (recovered?.settled && recovered.apiKey) {
    return {
      apiKey: recovered.apiKey,
      apiKeyId: recovered.apiKeyId ?? '',
      baseUrl: endpoints.inferenceBaseUrl,
      model: recovered.model?.trim() || model,
      clearReceipt: clearReceiptFor(recovered.paymentSessionId),
    }
  }

  // No deliverable receipt: this run must create/resume and exchange a checkout,
  // which needs a Bearer token. Resolve the password now and authenticate.
  const password =
    options.password ||
    process.env.AIMLAPI_PASSWORD ||
    (await promptHidden('AI/ML API password'))
  if (!password) {
    throw new Error('Password is required.')
  }

  const token = await authenticateAimlapiAccount(client, {
    email,
    password,
    inviteCode: options.inviteCode || process.env.AIMLAPI_INVITE_CODE,
    onStatus: options.onStatus,
  })

  const claimed = await claimAimlapiTopupStateAsync(intent)
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
  // Serialize the one-shot exchange across racing same-intent processes: only the
  // lease holder mints the key; a peer that loses resumes from the winner's
  // settled receipt. The key is handed back only in memory, so keep the settled
  // receipt rather than clearing here — an interruption before the caller
  // persists it would otherwise lose a paid-for credential permanently. A failed
  // record must NOT abort delivery; warn instead so the caller persists now.
  const { apiKey, apiKeyId, recorded } = await exchangeLeasedKey({
    client,
    token,
    intent,
    state,
    sessionToken: paid.sessionToken,
    model,
    onWaiting: () =>
      options.onStatus?.(
        'provisioning-key',
        'Another session is finishing this checkout; waiting for the issued key...',
      ),
  })
  if (!recorded) {
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
      // Transient poll failures (network, timeout, rate-limit, 5xx) — and a
      // malformed-but-successful body (AimlapiApiError status 200, a non-terminal
      // signal) — shouldn't abort a payment in progress. The resume path treats
      // a status-200 read the same way.
      if (
        isTransientHttpError(error) ||
        (error instanceof AimlapiApiError && error.status === 200)
      ) {
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
