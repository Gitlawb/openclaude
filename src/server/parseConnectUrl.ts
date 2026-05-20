export function parseConnectUrl(url: string): {
  serverUrl: string
  authToken: string | undefined
} {
  const parsed = new URL(url)
  return {
    serverUrl: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    authToken: parsed.searchParams.get('token') ?? undefined,
  }
}
