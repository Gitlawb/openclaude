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

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 20 * 60 * 1000 // 20 minutes

/**
 * A recorded session is only worth resuming while it can still reach a paid
 * exchange. `exchanging`/`exchanged` mean the one-shot key was already claimed,
 * and the terminal states are dead, so both start a fresh checkout instead.
 */
const RESUMABLE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  'pending_auth',
  'pending_payment',
  'paid',
])

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
    try {
      const existing = await client.getSession(state.resumeSessionToken)
      if (RESUMABLE_SESSION_STATUSES.has(existing.status)) {
        return { session: existing, state }
      }
    } catch (error) {
      // Only a definitive answer may retire the recorded checkout. A network
      // blip or 5xx says nothing about the session, and discarding it here would
      // open — and charge — a second checkout for a still-payable one. Surface it
      // instead: the record survives, so a re-run resumes. `pollUntilPaid` draws
      // the same line.
      if (
        error instanceof AimlapiApiError &&
        (error.status === 0 || error.status >= 500)
      ) {
        throw error
      }
      // Anything else is a definitive failure to read the session; fall through.
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
  const client = new AimlapiClient(endpoints)

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
  if (session.status === 'paid') {
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
        `\n  [warn] Could not record the recovery receipt for the issued key.` +
          `\n         Save it now if the next step fails: ${maskKey(apiKey)} (id ${apiKeyId})`,
      ),
    )
  }

  // 7. Persist into OpenClaude's provider profile.
  const profilePath = saveProfileFile({
    profile: 'openai',
    env: {
      OPENAI_BASE_URL: endpoints.inferenceBaseUrl,
      OPENAI_API_KEY: apiKey,
      OPENAI_MODEL: model,
    },
    createdAt: new Date().toISOString(),
  })

  // The credential is now in the profile, so the recovery record is spent.
  clearAimlapiTopupState({ ...intent, paymentSessionId: state.paymentSessionId })

  console.log(chalk.green(`\n  [OK] Balance topped up and provider configured.`))
  console.log(`    key      ${chalk.dim(maskKey(apiKey))}  (id ${apiKeyId})`)
  console.log(`    base URL ${chalk.dim(endpoints.inferenceBaseUrl)}`)
  console.log(`    model    ${chalk.dim(model)}`)
  console.log(`    profile  ${chalk.dim(profilePath)}`)
  console.log(chalk.dim(`\n  Run ${chalk.bold('openclaude')} to start coding on AI/ML API.\n`))
}

export async function provisionAimlapiKey(
  options: AimlapiProvisionOptions,
): Promise<AimlapiProvisionedKey> {
  const endpoints = resolveEndpoints()
  const client = new AimlapiClient(endpoints)

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
  const claimed = claimAimlapiTopupState(intent)
  // A previous run already exchanged the key but was interrupted before the
  // caller could persist it: hand back that credential instead of paying again.
  if (claimed.settled && claimed.apiKey) {
    clearAimlapiTopupState({ ...intent, paymentSessionId: claimed.paymentSessionId })
    return {
      apiKey: claimed.apiKey,
      apiKeyId: claimed.apiKeyId ?? '',
      baseUrl: endpoints.inferenceBaseUrl,
      model: claimed.model?.trim() || model,
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
  if (session.status === 'paid') {
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
      // Transient poll failures shouldn't abort a payment in progress.
      // status 0 is a network-level failure (see client.ts), not a real HTTP response.
      if (error instanceof AimlapiApiError && (error.status === 0 || error.status >= 500)) {
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
        throw new Error(
          'Session was already exchanged. The key can only be issued once - rotate it from the AI/ML API dashboard.',
        )
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
