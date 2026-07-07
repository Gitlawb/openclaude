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

  // 2. Partner-checkout session.
  const session = await client.createSession({ partnerId, partnerName })
  console.log(chalk.dim(`  -> Session ${session.id}`))

  // 3. Bind + open hosted payment page. The co-branded return URLs make the
  // post-payment browser redirect land on the AI/ML API success / failure
  // screen for this partner.
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
  const paid = await pollUntilPaid(client, session.sessionToken)

  // 6. Exchange the paid session for the raw key (once).
  console.log(chalk.dim('  -> Provisioning API key...'))
  const { apiKey, apiKeyId } = await client.exchange(token, paid.sessionToken)

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

  options.onStatus?.('creating-session')
  const session = await client.createSession({ partnerId, partnerName })

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
  const paid = await pollUntilPaid(client, session.sessionToken)

  options.onStatus?.('provisioning-key')
  const { apiKey, apiKeyId } = await client.exchange(token, paid.sessionToken)

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
