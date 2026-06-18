/**
 * Centralized credential redaction utility.
 *
 * Single source of truth for redacting secrets (API keys, tokens, passwords)
 * from strings and JSON values that flow into logs, bug reports, transcript
 * shares, and other diagnostic surfaces. The shape of the regex set lives
 * here; call sites should never fork their own copy of these patterns.
 *
 * Two exports:
 *
 * - `redactSensitiveInfo(text)`: pass a free-form string (log line, error
 *   message, transcript body) and get back a copy with secrets replaced.
 *   Cheap enough to call inline; runs a fixed sequence of regexes.
 *
 * - `jsonRedactor(key, value)`: a `JSON.stringify` replacer that redacts
 *   string values whose key looks like a credential field, and runs
 *   `redactSensitiveInfo` over every other string. Use this when you need
 *   structural protection (an unknown field could still hold a secret).
 *
 * Provider coverage is generated from two sources:
 * - `getKnownProviderSecretEnvKeys()` for env-var name patterns, so a new
 *   provider added via the descriptor registry is covered automatically.
 * - Hard-coded prefix patterns for the well-known token formats (sk-ant-...,
 *   AIza..., ghp_..., etc.) which show up outside of env-var contexts.
 */

import { getKnownProviderSecretEnvKeys } from './providerSecrets.js'

// Anthropic API keys (sk-ant-...)
const ANTHROPIC_KEY_PATTERN =
  /(?<![A-Za-z0-9"'])(sk-ant-?[A-Za-z0-9_-]{10,})(?![A-Za-z0-9"'])/g

// OpenAI / Codex / OpenRouter API keys (sk-..., sk-proj-..., sk-or-v1-...)
const OPENAI_KEY_PATTERN =
  /(?<![A-Za-z0-9"'])(sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{5,})(?![A-Za-z0-9"'])/g

// AWS access keys
const AWS_ACCESS_KEY_PATTERN = /(AKIA[A-Z0-9]{16})/g

// Google Cloud / Gemini API keys (AIza...) — 35-char suffix matches real GCP
// keys which are typically 39 chars total. The diagnostics module uses {10,}
// because it sees values out of context; here we only flag clearly-shaped keys.
const GCP_KEY_PATTERN = /(?<![A-Za-z0-9])(AIza[A-Za-z0-9_-]{10,})(?![A-Za-z0-9])/g

// Vertex AI service account emails
const GCP_SERVICE_ACCOUNT_PATTERN =
  /(?<![A-Za-z0-9])([a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com)(?![A-Za-z0-9])/g

// GitHub personal access tokens (ghp_, gho_, ghs_, ghu_, ghr_, github_pat_)
const GITHUB_TOKEN_PATTERN =
  /(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}(?![A-Za-z0-9])/g

// "AWS key: \"AKIA...\"" — provider-specific debug-message wrapping
const AWS_KEY_LABELED_PATTERN = /AWS key:\s*"(AWS[A-Z0-9]{20,})"/g

// Generic x-api-key header redaction
const X_API_KEY_PATTERN =
  /(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\s)}\]]+/gi

// Authorization header / Bearer token redaction
const AUTHORIZATION_PATTERN =
  /(["']?authorization["']?\s*[:=]\s*["']?(?:bearer\s+)?)[^"',\s)}\]]+/gi

// AWS_* / GOOGLE_* / provider-prefixed env var redaction
const PROVIDER_PREFIXED_ENV_PATTERN =
  /((?:AWS|GOOGLE)[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi

// Generic credential env var names (*_API_KEY, *_SECRET, *_TOKEN, *_PASSWORD)
// with strict negative lookarounds so we don't redact normal text that
// happens to contain "API_KEY=" mid-sentence.
const GENERIC_CREDENTIAL_ENV_PATTERN =
  /(?<![A-Za-z0-9_])((?:[A-Za-z0-9_]*_)?(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi

// Header-style key-value: x-api-key, authorization, bearer, api_key, token,
// access_token, refresh_token, secret, password, cookie, set-cookie, id_token.
// This is the catch-all for "the secret sits next to a known field name in
// arbitrary text" — header dumps, log lines, error payloads.
const GENERIC_HEADER_FIELD_PATTERN =
  /(["']?(?:x-api-key|authorization|bearer|api[-_]?key|token|access[-_]?token|refresh[-_]?token|secret|password|cookie|set[-_]?cookie|id[-_]?token|exchanged[-_]?api[-_]?key|trusted[-_]?device[-_]?token)["']?\s*[:=]\s*["']?)(?:bearer\s+)?([^"',\s)}\]]+)/gi

// Substrings that flag a JSON field name as a credential container, used by
// `jsonRedactor`. Normalized keys (lowercased, dashes/underscores stripped)
// are checked against this list.
const SENSITIVE_FIELD_SUBSTRINGS = [
  'token',
  'apikey',
  'secret',
  'password',
  'authorization',
  'cookie',
  'credential',
  'bearer',
] as const

/**
 * Build a regex matching a known credential env-var name on the left side of
 * an `=` or `:` assignment, e.g. `OPENAI_API_KEY=...` or `GITHUB_TOKEN: ...`.
 * Generated from `getKnownProviderSecretEnvKeys()` so a new provider added
 * to the descriptor registry is automatically covered.
 */
function buildKnownEnvVarPattern(): RegExp {
  const keys = getKnownProviderSecretEnvKeys()
  if (keys.length === 0) {
    // Should never happen in practice (FALLBACK_SECRET_ENV_KEYS is non-empty),
    // but returning a non-matching pattern keeps the call site branchless.
    return /(?!)/
  }
  // Sort longest-first so OPENAI_API_KEY is tried before API_KEY would be.
  const sorted = [...keys].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(
    `(?<![A-Za-z0-9_])(${escaped.join('|')})\\s*[=:]\\s*["']?[^"'\\s)}\\]]+["']?`,
    'gi',
  )
}

let cachedEnvVarPattern: RegExp | null = null
function getKnownEnvVarPattern(): RegExp {
  if (cachedEnvVarPattern === null) {
    cachedEnvVarPattern = buildKnownEnvVarPattern()
  }
  return cachedEnvVarPattern
}

/**
 * Reset the cached env-var pattern. Test-only escape hatch; production code
 * should not need this.
 * @internal
 */
export function _resetRedactionCacheForTesting(): void {
  cachedEnvVarPattern = null
}

/**
 * Redact known secret values from a free-form string.
 *
 * Applies a fixed sequence of regexes covering well-known credential
 * formats (Anthropic, OpenAI, AWS, GCP, GitHub) plus generic env-var and
 * header-field patterns. Safe to call inline on log lines or error
 * messages; cost is one pass per pattern.
 */
export function redactSensitiveInfo(text: string): string {
  let redacted = text

  // Anthropic API keys (sk-ant...)
  redacted = redacted.replace(ANTHROPIC_KEY_PATTERN, '[REDACTED_API_KEY]')

  // OpenAI / Codex / OpenRouter API keys
  redacted = redacted.replace(OPENAI_KEY_PATTERN, '[REDACTED_OPENAI_KEY]')

  // AWS access keys (AKIA...) and labeled debug output ("AWS key: \"...\"")
  redacted = redacted.replace(AWS_ACCESS_KEY_PATTERN, '[REDACTED_AWS_KEY]')
  redacted = redacted.replace(
    AWS_KEY_LABELED_PATTERN,
    'AWS key: "[REDACTED_AWS_KEY]"',
  )

  // Google Cloud / Gemini API keys
  redacted = redacted.replace(GCP_KEY_PATTERN, '[REDACTED_GCP_KEY]')

  // Vertex AI service account emails
  redacted = redacted.replace(
    GCP_SERVICE_ACCOUNT_PATTERN,
    '[REDACTED_GCP_SERVICE_ACCOUNT]',
  )

  // GitHub tokens
  redacted = redacted.replace(GITHUB_TOKEN_PATTERN, '[REDACTED_GITHUB_TOKEN]')

  // x-api-key header values
  redacted = redacted.replace(X_API_KEY_PATTERN, '$1[REDACTED_API_KEY]')

  // Authorization: Bearer ... headers
  redacted = redacted.replace(AUTHORIZATION_PATTERN, '$1[REDACTED_TOKEN]')

  // AWS_*/GOOGLE_* env vars
  redacted = redacted.replace(
    PROVIDER_PREFIXED_ENV_PATTERN,
    '$1[REDACTED]',
  )

  // Known provider env vars (from descriptor registry)
  redacted = redacted.replace(getKnownEnvVarPattern(), '$1[REDACTED]')

  // Generic *_API_KEY / *_SECRET / *_TOKEN / *_PASSWORD env vars
  redacted = redacted.replace(
    GENERIC_CREDENTIAL_ENV_PATTERN,
    '$1[REDACTED]',
  )

  // Catch-all: any of the standard credential field names with a value
  redacted = redacted.replace(
    GENERIC_HEADER_FIELD_PATTERN,
    (_, prefix: string) => `${prefix}[REDACTED]`,
  )

  return redacted
}

/**
 * `JSON.stringify` replacer that redacts credential-shaped values.
 *
 * - If the key looks like a credential field (token, api_key, password,
 *   etc.), the value is replaced with `'[REDACTED]'` regardless of its
 *   type — preventing accidentally-unredacted objects from slipping
 *   through.
 * - Otherwise, string values are passed through `redactSensitiveInfo`
 *   so secrets embedded in free-form text are still caught.
 */
export function jsonRedactor(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase().replace(/[-_]/g, '')

  // Allow token usage fields through — they contain "token" but are not secrets
  const EXCLUDED_KEYS = [
    'inputtokens',
    'outputtokens',
    'cachereadinputtokens',
    'cachecreationinputtokens',
  ]
  if (EXCLUDED_KEYS.includes(normalizedKey)) {
    return value
  }

  if (
    SENSITIVE_FIELD_SUBSTRINGS.some(s => normalizedKey.includes(s))
  ) {
    return '[REDACTED]'
  }

  if (typeof value === 'string') {
    return redactSensitiveInfo(value)
  }

  return value
}
