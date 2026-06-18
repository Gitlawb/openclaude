import { homedir } from 'os'

import { redactUrlForDisplay } from './urlRedaction.js'

/**
 * Redact a URL for /status and other public-safe diagnostic surfaces.
 *
 * Wraps {@link redactUrlForDisplay} (which masks user/password and sensitive
 * query params) and additionally drops the fragment, which can carry tokens
 * or session IDs and is not useful when debugging proxy/TLS issues.
 *
 * Returned URLs are safe to paste in public issues or screenshots.
 */
export function redactUrlForStatus(rawUrl: string): string {
  if (!rawUrl) return rawUrl

  const redacted = redactUrlForDisplay(rawUrl)

  // Drop the fragment. On the well-formed path (new URL succeeded) the
  // produced string contains at most one '#', which is the fragment
  // delimiter. On the malformed/regex-fallback path there is normally no
  // '#' (userinfo containing '#' broke URL parsing and the regex consumed
  // it); slicing at a stray '#' there would only shorten already-safe
  // output, never expose a secret.
  const hashIndex = redacted.indexOf('#')
  return hashIndex === -1 ? redacted : redacted.slice(0, hashIndex)
}

/**
 * Redact a filesystem path for /status and other public-safe diagnostic
 * surfaces. Replaces a leading $HOME segment with `~` so absolute paths
 * (e.g. mTLS cert/key, CA bundle) stay useful without leaking usernames
 * or home directory layout.
 */
export function redactPathForStatus(rawPath: string): string {
  if (!rawPath) return rawPath

  const stripTrailingSep = (path: string) => path.replace(/[\\/]+$/, '')
  const isWindowsLike = (path: string) =>
    /^[a-zA-Z]:[\\/]/.test(path) || path.includes('\\')
  const normalizeForCompare = (path: string) =>
    isWindowsLike(path) ? path.toLowerCase() : path
  const normalizedRawPath = stripTrailingSep(rawPath)
  const rawPathForCompare = normalizeForCompare(normalizedRawPath)

  // Cover POSIX (`HOME`), Windows (`USERPROFILE`), and containers where
  // neither is set (`os.homedir()` reads the OS passwd db). Check each
  // candidate; redact on the first prefix match. Filter out root-like
  // candidates so a misconfigured homedir never causes mass over-redaction.
  const candidates = [
    process.env.HOME,
    process.env.USERPROFILE,
    homedir(),
  ]
    .filter((h): h is string => Boolean(h))
    .map(stripTrailingSep)
    .filter(home => home !== '' && home !== '/' && !/^[a-zA-Z]:$/.test(home))

  for (const home of candidates) {
    const homeForCompare = normalizeForCompare(home)
    if (rawPathForCompare === homeForCompare) return '~'
    // Match either `/home/user/...` or `C:\Users\user\...` style prefixes.
    if (
      rawPathForCompare.startsWith(homeForCompare + '/') ||
      rawPathForCompare.startsWith(homeForCompare + '\\')
    ) {
      return '~' + rawPath.slice(home.length)
    }
  }
  return rawPath
}
