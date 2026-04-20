const SENSITIVE_URL_QUERY_PARAM_TOKENS = [
  'api_key',
  'apikey',
  'key',
  'token',
  'access_token',
  'refresh_token',
  'signature',
  'sig',
  'secret',
  'password',
  'passwd',
  'pwd',
  'auth',
  'authorization',
]

function shouldRedactUrlQueryParam(name: string): boolean {
  const lower = name.toLowerCase()
  return SENSITIVE_URL_QUERY_PARAM_TOKENS.some(token => lower.includes(token))
}

export function redactUrlForDisplay(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.username) {
      parsed.username = 'redacted'
    }
    if (parsed.password) {
      parsed.password = 'redacted'
    }

    for (const key of parsed.searchParams.keys()) {
      if (shouldRedactUrlQueryParam(key)) {
        parsed.searchParams.set(key, 'redacted')
      }
    }

    return parsed.toString()
  } catch {
    return rawUrl
      .replace(/\/\/[^/@\s]+(?::[^/@\s]*)?@/g, '//redacted@')
      .replace(
        /([?&](?:token|access_token|refresh_token|api_key|apikey|key|password|passwd|pwd|auth|authorization|signature|sig|secret)=)[^&#]*/gi,
        '$1redacted',
      )
  }
}