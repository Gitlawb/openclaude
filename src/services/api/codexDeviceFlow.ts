import { openBrowser } from '../../utils/browser.js'
import {
  asTrimmedString,
  CODEX_OAUTH_ISSUER,
  CODEX_OAUTH_ORIGINATOR,
  CODEX_OAUTH_SCOPE,
  CODEX_REFRESH_URL,
  exchangeCodexIdTokenForApiKey,
  getCodexOAuthClientId,
  parseChatgptAccountId,
} from './codexOAuthShared.js'
import type { CodexOAuthTokens } from './codexOAuth.js'

export const CODEX_DEVICE_CODE_URL = `${CODEX_OAUTH_ISSUER}/oauth/device/code`
export const CODEX_DEVICE_TOKEN_GRANT =
  'urn:ietf:params:oauth:grant-type:device_code'
const CODEX_DEVICE_FLOW_REQUEST_TIMEOUT_MS = 15_000

export class CodexDeviceFlowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexDeviceFlowError'
  }
}

export type CodexDeviceCodeResult = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  interval: number
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function createRequestSignal(
  signal?: AbortSignal,
  timeoutMs = CODEX_DEVICE_FLOW_REQUEST_TIMEOUT_MS,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)))
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = (): void => {
      cleanup()
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }

    const cleanup = (): void => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }

    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(new DOMException('The operation was aborted.', 'AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function readString(value: unknown): string | undefined {
  return asTrimmedString(value)
}

function parseDeviceCodeResponse(payload: Record<string, unknown>): CodexDeviceCodeResult {
  const deviceCode = readString(payload.device_code)
  const userCode = readString(payload.user_code)
  const verificationUri =
    readString(payload.verification_uri) ?? readString(payload.verification_url)
  const verificationUriComplete =
    readString(payload.verification_uri_complete) ??
    readString(payload.verification_url_complete)
  const expiresIn = Number(payload.expires_in)
  const interval = Number(payload.interval)

  if (
    !deviceCode ||
    !userCode ||
    !verificationUri ||
    !Number.isFinite(expiresIn) ||
    !Number.isFinite(interval)
  ) {
    throw new CodexDeviceFlowError(
      'Codex device-code response was missing required fields.',
    )
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval: interval > 0 ? interval : 5,
  }
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as unknown
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function getErrorMessage(response: Response, payload: Record<string, unknown>): string {
  const error = readString(payload.error)
  const description = readString(payload.error_description)
  const detail = description ?? error
  if (detail) {
    return `Codex device-code request failed (${response.status}): ${detail}`
  }
  return `Codex device-code request failed with status ${response.status}.`
}

export async function requestCodexDeviceCode(options?: {
  clientId?: string
  scope?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
  requestTimeoutMs?: number
}): Promise<CodexDeviceCodeResult> {
  const fetchFn = options?.fetchImpl ?? fetch
  const body = new URLSearchParams({
    client_id: options?.clientId ?? getCodexOAuthClientId(),
    scope: options?.scope ?? CODEX_OAUTH_SCOPE,
    originator: CODEX_OAUTH_ORIGINATOR,
    id_token_add_organizations: 'true',
  })

  const response = await fetchFn(CODEX_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: createRequestSignal(options?.signal, options?.requestTimeoutMs),
  })

  const payload = await readJsonResponse(response)
  if (!response.ok) {
    throw new CodexDeviceFlowError(getErrorMessage(response, payload))
  }

  return parseDeviceCodeResponse(payload)
}

async function pollTokenOnce(options: {
  deviceCode: string
  clientId: string
  fetchImpl: FetchLike
  signal?: AbortSignal
}): Promise<
  | { state: 'pending'; interval?: number }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'slow_down'; interval?: number }
  | { state: 'success'; tokens: CodexOAuthTokens }
  | { state: 'error'; message: string }
> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    grant_type: CODEX_DEVICE_TOKEN_GRANT,
    device_code: options.deviceCode,
  })

  const response = await options.fetchImpl(CODEX_REFRESH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: options.signal,
  })

  const payload = await readJsonResponse(response)
  if (response.ok) {
    const accessToken = readString(payload.access_token)
    const refreshToken = readString(payload.refresh_token)
    const idToken = readString(payload.id_token)
    const accountId =
      readString(payload.chatgpt_account_id) ??
      parseChatgptAccountId(idToken) ??
      parseChatgptAccountId(accessToken)

    if (!accessToken || !refreshToken) {
      return {
        state: 'error',
        message:
          'Codex device-code sign-in completed, but no usable tokens were returned.',
      }
    }

    const apiKey = idToken
      ? await exchangeCodexIdTokenForApiKey(idToken).catch(() => undefined)
      : undefined

    return {
      state: 'success',
      tokens: {
        apiKey,
        accessToken,
        refreshToken,
        idToken,
        accountId,
      },
    }
  }

  const error = readString(payload.error)
  const interval = Number(payload.interval)

  switch (error) {
    case 'authorization_pending':
      return {
        state: 'pending',
        interval: Number.isFinite(interval) && interval > 0 ? interval : undefined,
      }
    case 'slow_down':
      return {
        state: 'slow_down',
        interval: Number.isFinite(interval) && interval > 0 ? interval : undefined,
      }
    case 'access_denied':
    case 'authorization_declined':
      return { state: 'denied' }
    case 'expired_token':
      return { state: 'expired' }
    default:
      return {
        state: 'error',
        message: getErrorMessage(response, payload),
      }
  }
}

export async function pollCodexDeviceToken(
  deviceCode: string,
  options?: {
    clientId?: string
    initialInterval?: number
    timeoutSeconds?: number
    fetchImpl?: FetchLike
    signal?: AbortSignal
  },
): Promise<CodexOAuthTokens> {
  const fetchFn = options?.fetchImpl ?? fetch
  const clientId = options?.clientId ?? getCodexOAuthClientId()
  let interval = Math.max(1, Math.floor(options?.initialInterval ?? 5))
  const timeoutMs = Math.max(1, Math.floor(options?.timeoutSeconds ?? 15 * 60)) * 1000
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const result = await pollTokenOnce({
      deviceCode,
      clientId,
      fetchImpl: fetchFn,
      signal: options?.signal,
    })

    if (result.state === 'success') {
      return result.tokens
    }
    if (result.state === 'error') {
      throw new CodexDeviceFlowError(result.message)
    }
    if (result.state === 'denied') {
      throw new CodexDeviceFlowError('Authorization was denied or cancelled.')
    }
    if (result.state === 'expired') {
      throw new CodexDeviceFlowError('Device code expired. Start the login flow again.')
    }

    if (result.state === 'slow_down' && result.interval) {
      interval = Math.max(interval + 5, result.interval)
    } else if (result.interval) {
      interval = Math.max(1, result.interval)
    }

    await sleep(interval * 1000, options?.signal)
  }

  throw new CodexDeviceFlowError('Device code expired. Start the login flow again.')
}

export async function openVerificationUri(uri: string): Promise<boolean> {
  return openBrowser(uri)
}
