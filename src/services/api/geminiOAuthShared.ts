export const GEMINI_OAUTH_ISSUER = 'https://accounts.google.com'
export const GEMINI_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const DEFAULT_GEMINI_OAUTH_CLIENT_ID = [
  '681255809395-oo8ft2oprdrnp9e3',
  'aqf6av3hmdib135j.apps.googleusercontent.com'
].join('')

export const GEMINI_OAUTH_CLIENT_SECRET = [
  'GOCSPX',
  '-4uHgMPm-1o7Sk-geV6Cu5clXFsxl'
].join('')

export const DEFAULT_GEMINI_OAUTH_CALLBACK_PORT = 1456
export const GEMINI_OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
].join(' ')

export function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function getGeminiOAuthClientId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return asTrimmedString(env.GEMINI_OAUTH_CLIENT_ID) ?? DEFAULT_GEMINI_OAUTH_CLIENT_ID
}

export function getGeminiOAuthCallbackPort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawPort = asTrimmedString(env.GEMINI_OAUTH_CALLBACK_PORT)
  if (!rawPort) {
    return DEFAULT_GEMINI_OAUTH_CALLBACK_PORT
  }

  const parsed = Number.parseInt(rawPort, 10)
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed
  }

  return DEFAULT_GEMINI_OAUTH_CALLBACK_PORT
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
