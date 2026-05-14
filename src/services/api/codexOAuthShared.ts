import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'

export const CODEX_OAUTH_ISSUER = 'https://auth.openai.com'
export const CODEX_REFRESH_URL = `${CODEX_OAUTH_ISSUER}/oauth/token`
export const DEFAULT_CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const DEFAULT_CODEX_OAUTH_CALLBACK_PORT = 1455
export const CODEX_OAUTH_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
export const CODEX_OAUTH_ORIGINATOR = 'codex_cli_rs'
export const CODEX_API_KEY_TOKEN_NAME = 'openai-api-key'
export const CODEX_ID_TOKEN_SUBJECT_TYPE =
  'urn:ietf:params:oauth:token-type:id_token'
export const CODEX_TOKEN_EXCHANGE_GRANT =
  'urn:ietf:params:oauth:grant-type:token-exchange'

export function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function getCodexOAuthClientId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return asTrimmedString(env.CODEX_OAUTH_CLIENT_ID) ?? DEFAULT_CODEX_OAUTH_CLIENT_ID
}

export function getCodexOAuthCallbackPort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawPort = asTrimmedString(env.CODEX_OAUTH_CALLBACK_PORT)
  if (!rawPort) {
    return DEFAULT_CODEX_OAUTH_CALLBACK_PORT
  }

  const parsed = Number.parseInt(rawPort, 10)
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed
  }

  return DEFAULT_CODEX_OAUTH_CALLBACK_PORT
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function parseChatgptAccountId(
  token: string | undefined,
): string | undefined {
  if (!token) return undefined

  const payload = decodeJwtPayload(token)
  const nestedAuth =
    payload?.['https://api.openai.com/auth'] &&
    typeof payload['https://api.openai.com/auth'] === 'object'
      ? (payload['https://api.openai.com/auth'] as Record<string, unknown>)
      : undefined

  return (
    asTrimmedString(
      nestedAuth?.chatgpt_account_id ??
        payload?.['https://api.openai.com/auth.chatgpt_account_id'] ??
        payload?.chatgpt_account_id,
    ) ?? undefined
  )
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case '\'':
        return '&#39;'
      default:
        return char
    }
  })
}

export async function exchangeCodexIdTokenForApiKey(
  idToken: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: CODEX_TOKEN_EXCHANGE_GRANT,
    client_id: getCodexOAuthClientId(),
    requested_token: CODEX_API_KEY_TOKEN_NAME,
    subject_token: idToken,
    subject_token_type: CODEX_ID_TOKEN_SUBJECT_TYPE,
  })

  const { signal, cleanup } = createCombinedAbortSignal(undefined, {
    timeoutMs: 15_000,
  })
  try {
    const response = await fetch(CODEX_REFRESH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal,
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw new Error(
        bodyText.trim()
          ? `Codex API key exchange failed (${response.status}): ${bodyText.trim()}`
          : `Codex API key exchange failed with status ${response.status}.`,
      )
    }

    const payload = (await response.json()) as { access_token?: string }
    const apiKey = asTrimmedString(payload.access_token)
    if (!apiKey) {
      throw new Error(
        'Codex API key exchange completed, but no API key token was returned.',
      )
    }

    return apiKey
  } finally {
    cleanup()
  }
}
