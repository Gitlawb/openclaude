import { homedir } from 'node:os'
import { PROVIDER_PRESET_MANIFEST } from '../../integrations/index.js'
import { redactUrlForDisplay } from '../urlRedaction.js'

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|auth(?:orization)?|bearer|cookie|credential|password|passwd|pwd|private[_-]?key|refresh[_-]?token|secret|token)/i

const LIKELY_SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
  /\bAIza[0-9A-Za-z_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{10,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g,
]

export type SecretEnvPresence = {
  name: string
  present: boolean
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function collectProviderSecretEnvVars(): string[] {
  return unique(
    PROVIDER_PRESET_MANIFEST.flatMap(preset =>
      'apiKeyEnvVars' in preset ? [...preset.apiKeyEnvVars] : [],
    ),
  )
}

export function summarizeSecretEnvPresence(
  env: NodeJS.ProcessEnv,
  envVars: readonly string[] = collectProviderSecretEnvVars(),
): SecretEnvPresence[] {
  return unique(envVars).map(name => ({
    name,
    present: Boolean(env[name]?.trim()),
  }))
}

export function redactDiagnosticUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined
  return redactUrlForDisplay(rawUrl).replace(/\/+$/, '')
}

export function redactHomePath(
  value: string,
  homeDir = homedir(),
): string {
  if (!value || !homeDir) return value
  const normalizedHome = homeDir.replace(/[/\\]+$/, '')
  if (!normalizedHome) return value
  return value.replace(
    new RegExp(`${escapeRegExp(normalizedHome)}(?=$|[/\\\\])`, 'g'),
    '~',
  )
}

export function redactLikelySecrets(value: string): string {
  return LIKELY_SECRET_VALUE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '[redacted]'),
    value,
  )
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

function isEnvPresenceKey(key: string): boolean {
  return /^[A-Z0-9_]+$/.test(key) && /(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTH)/.test(key)
}

export function redactDiagnosticObject(value: unknown): unknown {
  return redactDiagnosticObjectInternal(value)
}

function redactDiagnosticObjectInternal(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    if (key && isSecretKey(key)) {
      return isEnvPresenceKey(key) ? '[set]' : '[redacted]'
    }
    return redactLikelySecrets(redactHomePath(value))
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => redactDiagnosticObjectInternal(item))
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactDiagnosticObjectInternal(entryValue, entryKey)
    }
    return output
  }

  return String(value)
}
