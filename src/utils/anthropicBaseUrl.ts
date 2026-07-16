export function isFirstPartyAnthropicBaseUrlForEnv(
  processEnv: NodeJS.ProcessEnv,
): boolean {
  const baseUrl = processEnv.ANTHROPIC_BASE_URL
  if (!baseUrl) return true

  try {
    const allowedHosts = ['api.anthropic.com']
    if (processEnv.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    const url = new URL(baseUrl)
    return (
      url.protocol === 'https:' &&
      allowedHosts.includes(url.hostname) &&
      (url.port === '' || url.port === '443')
    )
  } catch {
    return false
  }
}
