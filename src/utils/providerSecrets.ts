import type { ProviderPresetManifestEntry } from '../integrations/descriptors.js'
import {
  ANTHROPIC_PROXY_DESCRIPTORS,
  GATEWAY_DESCRIPTORS,
  PROVIDER_PRESET_MANIFEST,
  VENDOR_DESCRIPTORS,
} from '../integrations/generated/integrationArtifacts.generated.js'

// Manually-curated fallback. Kept defensive for legacy and OAuth/token
// credential paths that either predate descriptors or are accepted by
// provider-specific auth helpers outside setup.credentialEnvVars.
const FALLBACK_SECRET_ENV_KEYS: readonly string[] = [
  'OPENAI_API_KEY',
  'OPENAI_AUTH_HEADER_VALUE',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_ACCESS_TOKEN',
  'MISTRAL_API_KEY',
  'BNKR_API_KEY',
  'XAI_API_KEY',
]

function readDescriptorCredentialEnvKeys(): readonly string[] {
  const keys = new Set<string>()

  const presets: readonly ProviderPresetManifestEntry[] = PROVIDER_PRESET_MANIFEST
  for (const preset of presets) {
    for (const key of preset.apiKeyEnvVars ?? []) {
      if (key) keys.add(key)
    }
  }

  const descriptorsWithSetup = [
    ...VENDOR_DESCRIPTORS,
    ...GATEWAY_DESCRIPTORS,
    ...(ANTHROPIC_PROXY_DESCRIPTORS as readonly { setup?: { credentialEnvVars?: readonly string[] } }[]),
  ]
  for (const descriptor of descriptorsWithSetup) {
    for (const key of descriptor.setup?.credentialEnvVars ?? []) {
      if (key) keys.add(key)
    }

    const validation = (descriptor as { validation?: { credentialEnvVars?: readonly string[] } }).validation
    for (const key of validation?.credentialEnvVars ?? []) {
      if (key) keys.add(key)
    }
  }

  return [...keys]
}

let cachedKnownSecretKeys: readonly string[] | null = null

/**
 * Every environment variable name that the integration registry declares as
 * holding a provider credential. Used to decide which display values must be
 * redacted. Derived from PROVIDER_PRESET_MANIFEST plus descriptor setup and
 * validation metadata so adding a new provider cannot silently create an
 * unredacted path.
 */
export function getKnownProviderSecretEnvKeys(): readonly string[] {
  if (cachedKnownSecretKeys) return cachedKnownSecretKeys
  const merged = new Set<string>(FALLBACK_SECRET_ENV_KEYS)
  for (const key of readDescriptorCredentialEnvKeys()) {
    merged.add(key)
  }
  cachedKnownSecretKeys = Object.freeze([...merged])
  return cachedKnownSecretKeys
}

// Secret sources are intentionally open: a provider can declare new credential
// env vars at any time, and forcing callers through a closed union would
// re-introduce the drift this module exists to prevent.
export type SecretValueSource = Partial<Record<string, string | undefined>>

export function sanitizeApiKey(
  key: string | null | undefined,
): string | undefined {
  if (!key || key === 'SUA_CHAVE') return undefined
  return key
}

// Heuristic masks for secret-shaped values whose env var name is not known.
// These catch values that slipped into display fields through unexpected paths
// (profile files, custom base URLs with embedded tokens, hand-edited configs).
const SECRET_PREFIX_PATTERNS = [
  /^sk-/,
  /^sk-ant-/,
  /^AIza/,
  /^ghp_/,
  /^gho_/,
  /^ghu_/,
  /^ghs_/,
  /^ghr_/,
  /^github_pat_/,
]

const SECRET_PREFIX_SUBSTRING_PATTERN =
  /(?:sk-ant-|sk-|AIza|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9._-]{8,}/g
const JWT_SUBSTRING_PATTERN =
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  for (const pattern of SECRET_PREFIX_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }

  return looksLikeOpaqueToken(trimmed)
}

// Opaque provider tokens are typically long, mixed-case alphanumeric payloads,
// sometimes with short prefix segments separated by dashes/underscores.
function looksLikeOpaqueToken(value: string): boolean {
  if (value.length < 24) return false
  if (value.includes('://')) return false
  if (value.includes(' ')) return false
  if (value.includes('/')) return false

  if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value)) {
    return true
  }

  for (const ch of value) {
    const isAllowed =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '-' ||
      ch === '_'
    if (!isAllowed) return false
  }

  return value
    .split(/[-_]+/)
    .some(segment => segment.length >= 16 && hasLowerUpperDigit(segment))
}

function hasLowerUpperDigit(value: string): boolean {
  let hasLower = false
  let hasUpper = false
  let hasDigit = false

  for (const ch of value) {
    if (ch >= 'a' && ch <= 'z') hasLower = true
    else if (ch >= 'A' && ch <= 'Z') hasUpper = true
    else if (ch >= '0' && ch <= '9') hasDigit = true
  }

  return hasLower && hasUpper && hasDigit
}

// Redaction sources may be full process env objects, so also collect values
// from generic credential-bearing suffixes. The descriptor registry covers
// known providers; this defensive path covers custom routes and cloud/database
// auth variables that can still be surfaced through status/config displays.
function isSecretEnvKey(
  key: string,
  knownKeys: ReadonlySet<string>,
): boolean {
  return (
    knownKeys.has(key) ||
    key.endsWith('_API_KEY') ||
    key.endsWith('_AUTH_HEADER_VALUE') ||
    key.endsWith('_PASSWORD') ||
    key.endsWith('_SECRET') ||
    key.endsWith('_SECRET_ACCESS_KEY') ||
    key.endsWith('_SECRET_KEY') ||
    key.endsWith('_TOKEN')
  )
}

function collectSecretValues(
  sources: Array<SecretValueSource | null | undefined>,
): string[] {
  const knownKeys = new Set(getKnownProviderSecretEnvKeys())
  const values = new Set<string>()

  for (const source of sources) {
    if (!source) continue

    for (const key of Object.keys(source)) {
      if (!isSecretEnvKey(key, knownKeys)) continue

      const value = sanitizeApiKey(source[key])?.trim()
      if (value) {
        values.add(value)
      }
    }
  }

  return [...values]
}

export function maskSecretForDisplay(
  value: string | null | undefined,
): string | undefined {
  const sanitized = sanitizeApiKey(value)
  if (!sanitized) return undefined

  if (sanitized.length <= 8) {
    return 'configured'
  }

  return `${sanitized.slice(0, 3)}...${sanitized.slice(-3)}`
}

export function redactSecretValueForDisplay(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return value

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return maskSecretForDisplay(trimmed) ?? 'configured'
  }

  return trimmed
}

export function redactSecretSubstringsForDisplay(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  let redacted = value
  const secretValues = collectSecretValues(sources).sort(
    (a, b) => b.length - a.length,
  )
  for (const secretValue of secretValues) {
    const mask = maskSecretForDisplay(secretValue) ?? 'configured'
    redacted = redacted.split(secretValue).join(mask)
  }

  redacted = redacted.replace(
    SECRET_PREFIX_SUBSTRING_PATTERN,
    match => maskSecretForDisplay(match) ?? 'configured',
  )
  redacted = redacted.replace(
    JWT_SUBSTRING_PATTERN,
    match => maskSecretForDisplay(match) ?? 'configured',
  )

  return redacted
}

export function sanitizeProviderConfigValue(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return undefined
  }

  return trimmed
}
