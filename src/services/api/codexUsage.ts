import {
  readCodexCredentialsAsync,
  refreshCodexAccessTokenIfNeeded,
} from '../../utils/codexCredentials.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import {
  DEFAULT_CODEX_BASE_URL,
  isCodexBaseUrl,
  resolveRuntimeCodexCredentials,
  resolveProviderRequest,
} from './providerConfig.js'

export type CodexUsageWindow = {
  usedPercent: number
  windowMinutes?: number
  resetsAt?: string
}

export type CodexUsageCredits = {
  hasCredits: boolean
  unlimited: boolean
  balance?: string
}

export type CodexUsageSnapshot = {
  limitName: string
  primary?: CodexUsageWindow
  secondary?: CodexUsageWindow
  credits?: CodexUsageCredits
}

export type CodexUsageData = {
  planType?: string
  snapshots: CodexUsageSnapshot[]
}

export type CodexUsageRow =
  | {
      kind: 'window'
      label: string
      usedPercent: number
      resetsAt?: string
    }
  | {
      kind: 'text'
      label: string
      value: string
    }

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function toIsoFromUnixSeconds(value: unknown): string | undefined {
  const seconds = asNumber(value)
  if (seconds === undefined) return undefined
  return new Date(seconds * 1000).toISOString()
}

function normalizeWindow(value: unknown): CodexUsageWindow | undefined {
  if (!isRecord(value)) return undefined

  const usedPercent =
    asNumber(value.used_percent) ?? asNumber(value.usedPercent)
  if (usedPercent === undefined) return undefined

  const windowMinutes =
    asNumber(value.window_minutes) ??
    asNumber(value.windowDurationMins) ??
    (() => {
      const seconds = asNumber(value.limit_window_seconds)
      return seconds === undefined ? undefined : Math.round(seconds / 60)
    })()

  const resetsAt =
    toIsoFromUnixSeconds(value.resets_at) ??
    toIsoFromUnixSeconds(value.resetsAt) ??
    toIsoFromUnixSeconds(value.reset_at)

  return {
    usedPercent,
    windowMinutes,
    resetsAt,
  }
}

function normalizeCredits(value: unknown): CodexUsageCredits | undefined {
  if (!isRecord(value)) return undefined

  const hasCredits =
    asBoolean(value.has_credits) ?? asBoolean(value.hasCredits) ?? false
  const unlimited = asBoolean(value.unlimited) ?? false
  const balance = asString(value.balance)

  if (!hasCredits && !unlimited && !balance) {
    return undefined
  }

  return {
    hasCredits,
    unlimited,
    balance,
  }
}

function normalizeSnapshot(
  value: unknown,
  fallbackLimitName: string,
): CodexUsageSnapshot | undefined {
  if (!isRecord(value)) return undefined

  const limitName =
    asString(value.limit_name) ??
    asString(value.limitName) ??
    asString(value.limit_id) ??
    asString(value.limitId) ??
    fallbackLimitName

  const primary =
    normalizeWindow(value.primary) ?? normalizeWindow(value.primary_window)
  const secondary =
    normalizeWindow(value.secondary) ?? normalizeWindow(value.secondary_window)
  const credits = normalizeCredits(value.credits)

  if (!primary && !secondary && !credits) {
    return undefined
  }

  return {
    limitName,
    primary,
    secondary,
    credits,
  }
}

function normalizeSnapshotsFromCollection(
  value: unknown,
  defaultLimitName = 'codex',
): CodexUsageSnapshot[] {
  if (Array.isArray(value)) {
    return value
      .map((item, index) =>
        normalizeSnapshot(
          item,
          index === 0 ? defaultLimitName : `${defaultLimitName}-${index + 1}`,
        ),
      )
      .filter((item): item is CodexUsageSnapshot => item !== undefined)
  }

  if (!isRecord(value)) return []

  return Object.entries(value)
    .map(([key, entry]) => normalizeSnapshot(entry, key))
    .filter((item): item is CodexUsageSnapshot => item !== undefined)
}

function normalizeLiveUsagePayload(payload: RecordLike): CodexUsageData {
  const planType = asString(payload.plan_type) ?? asString(payload.planType)
  const snapshots: CodexUsageSnapshot[] = []
  const codexCredits = normalizeCredits(payload.credits)

  const codexSnapshot = normalizeSnapshot(payload.rate_limit, 'codex')
  if (codexSnapshot) {
    codexSnapshot.credits ??= codexCredits
    snapshots.push(codexSnapshot)
  } else if (codexCredits) {
    snapshots.push({
      limitName: 'codex',
      credits: codexCredits,
    })
  }

  const codeReviewSnapshot = normalizeSnapshot(
    payload.code_review_rate_limit,
    'code review',
  )
  if (codeReviewSnapshot) {
    snapshots.push(codeReviewSnapshot)
  }

  snapshots.push(
    ...normalizeSnapshotsFromCollection(
      payload.additional_rate_limits ?? payload.additionalRateLimits,
      'additional',
    ),
  )

  return {
    planType,
    snapshots,
  }
}

export function normalizeCodexUsagePayload(payload: unknown): CodexUsageData {
  if (Array.isArray(payload)) {
    return {
      snapshots: normalizeSnapshotsFromCollection(payload),
    }
  }

  if (!isRecord(payload)) {
    return { snapshots: [] }
  }

  if (
    'rate_limit' in payload ||
    'code_review_rate_limit' in payload ||
    'additional_rate_limits' in payload ||
    'credits' in payload
  ) {
    return normalizeLiveUsagePayload(payload)
  }

  const collection =
    payload.rate_limits ??
    payload.rateLimits ??
    payload.rate_limits_by_limit_id ??
    payload.rateLimitsByLimitId

  if (collection !== undefined) {
    return {
      planType: asString(payload.plan_type) ?? asString(payload.planType),
      snapshots: normalizeSnapshotsFromCollection(collection),
    }
  }

  const snapshot = normalizeSnapshot(payload, 'codex')
  return {
    planType: asString(payload.plan_type) ?? asString(payload.planType),
    snapshots: snapshot ? [snapshot] : [],
  }
}

function capitalizeFirst(value: string): string {
  if (!value) return value
  return value[0]!.toUpperCase() + value.slice(1)
}

function formatWindowDuration(
  windowMinutes: number | undefined,
  fallback: string,
): string {
  if (windowMinutes === undefined || windowMinutes <= 0) {
    return fallback
  }

  if (windowMinutes === 60 * 24 * 7) {
    return 'weekly'
  }

  if (windowMinutes % (60 * 24) === 0) {
    return `${windowMinutes / (60 * 24)}d`
  }

  if (windowMinutes % 60 === 0) {
    return `${windowMinutes / 60}h`
  }

  return `${windowMinutes}m`
}

function formatCreditBalance(rawBalance: string | undefined): string | undefined {
  const balance = rawBalance?.trim()
  if (!balance) return undefined

  const intValue = Number.parseInt(balance, 10)
  if (Number.isFinite(intValue) && `${intValue}` === balance && intValue > 0) {
    return `${intValue}`
  }

  const floatValue = Number.parseFloat(balance)
  if (Number.isFinite(floatValue) && floatValue > 0) {
    return `${Math.round(floatValue)}`
  }

  return undefined
}

function buildCreditsRow(
  credits: CodexUsageCredits | undefined,
): CodexUsageRow | undefined {
  if (!credits?.hasCredits) return undefined
  if (credits.unlimited) {
    return {
      kind: 'text',
      label: 'Credits',
      value: 'Unlimited',
    }
  }

  const displayBalance = formatCreditBalance(credits.balance)
  if (!displayBalance) return undefined

  return {
    kind: 'text',
    label: 'Credits',
    value: `${displayBalance} credits`,
  }
}

export function buildCodexUsageRows(
  snapshots: CodexUsageSnapshot[],
): CodexUsageRow[] {
  const rows: CodexUsageRow[] = []

  for (const snapshot of snapshots) {
    const limitBucketLabel = snapshot.limitName.trim() || 'codex'
    const creditsRow = buildCreditsRow(snapshot.credits)
    const hasRenderableContent =
      snapshot.primary !== undefined ||
      snapshot.secondary !== undefined ||
      creditsRow !== undefined
    if (!hasRenderableContent) {
      continue
    }

    const showLimitPrefix = limitBucketLabel.toLowerCase() !== 'codex'
    const windowCount =
      Number(snapshot.primary !== undefined) +
      Number(snapshot.secondary !== undefined)
    const combineNonCodexSingleLimit = showLimitPrefix && windowCount === 1

    if (showLimitPrefix && !combineNonCodexSingleLimit) {
      rows.push({
        kind: 'text',
        label: `${capitalizeFirst(limitBucketLabel)} limit`,
        value: '',
      })
    }

    if (snapshot.primary) {
      const durationLabel = capitalizeFirst(
        formatWindowDuration(snapshot.primary.windowMinutes, '5h'),
      )
      rows.push({
        kind: 'window',
        label: combineNonCodexSingleLimit
          ? `${capitalizeFirst(limitBucketLabel)} ${durationLabel} limit`
          : `${durationLabel} limit`,
        usedPercent: snapshot.primary.usedPercent,
        resetsAt: snapshot.primary.resetsAt,
      })
    }

    if (snapshot.secondary) {
      const durationLabel = capitalizeFirst(
        formatWindowDuration(snapshot.secondary.windowMinutes, 'weekly'),
      )
      rows.push({
        kind: 'window',
        label: combineNonCodexSingleLimit
          ? `${capitalizeFirst(limitBucketLabel)} ${durationLabel} limit`
          : `${durationLabel} limit`,
        usedPercent: snapshot.secondary.usedPercent,
        resetsAt: snapshot.secondary.resetsAt,
      })
    }

    if (creditsRow) {
      rows.push(creditsRow)
    }
  }

  return rows
}

export function formatCodexPlanType(
  planType: string | undefined,
): string | undefined {
  if (!planType) return undefined
  return planType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => capitalizeFirst(part.toLowerCase()))
    .join(' ')
}

export function getCodexUsageUrl(baseUrl = DEFAULT_CODEX_BASE_URL): string {
  return new URL('/backend-api/wham/usage', baseUrl).toString()
}

export async function fetchCodexUsage(): Promise<CodexUsageData> {
  const refreshResult = await refreshCodexAccessTokenIfNeeded().catch(
    async error => {
      logForDebugging(
        `[codex] access token refresh failed before usage fetch: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' },
      )
      return {
        refreshed: false,
        credentials: await readCodexCredentialsAsync(),
      }
    },
  )
  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  if (!isCodexBaseUrl(request.baseUrl)) {
    throw new Error(
      'Codex usage is only available with the official ChatGPT Codex backend.',
    )
  }

  const credentials = resolveRuntimeCodexCredentials({
    storedCredentials: refreshResult.credentials,
  })
  if (!credentials.apiKey) {
    const oauthHint = isBareMode() ? '' : ', choose Codex OAuth in /provider'
    const authHint = credentials.authPath
      ? `${oauthHint} or place a Codex auth.json at ${credentials.authPath}`
      : oauthHint
    throw new Error(`Codex auth is required. Set CODEX_API_KEY${authHint}.`)
  }
  if (!credentials.accountId) {
    throw new Error(
      'Codex auth is missing chatgpt_account_id. Re-login with Codex OAuth, the Codex CLI, or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.',
    )
  }

  const response = await fetch(getCodexUsageUrl(request.baseUrl), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${credentials.apiKey}`,
      'chatgpt-account-id': credentials.accountId,
      originator: 'openclaude',
    },
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error')
    throw new Error(`Codex usage error ${response.status}: ${errorBody}`)
  }

  return normalizeCodexUsagePayload(await response.json())
}
