import { logForDebugging } from '../../utils/debug.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

type RecordLike = Record<string, unknown>

export type MiniMaxUsageWindow = {
  label: string
  usedPercent: number
  remaining?: number
  total?: number
  resetsAt?: string
}

export type MiniMaxUsageSnapshot = {
  limitName: string
  windows: MiniMaxUsageWindow[]
}

export type MiniMaxUsageRow =
  | {
      kind: 'window'
      label: string
      usedPercent: number
      resetsAt?: string
      extraSubtext?: string
    }
  | {
      kind: 'text'
      label: string
      value: string
    }

export type MiniMaxUsageData =
  | {
      availability: 'available'
      planType?: string
      snapshots: MiniMaxUsageSnapshot[]
    }
  | {
      availability: 'unknown'
      planType?: string
      snapshots: MiniMaxUsageSnapshot[]
      message: string
    }

const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
const DEFAULT_MINIMAX_UNAVAILABLE_MESSAGE =
  'Usage details are not available for this MiniMax account. This may be a pay-as-you-go key or a plan that does not expose quota status.'

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function toIsoDate(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString()
  }

  const numeric = asNumber(value)
  if (numeric === undefined) return undefined

  const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
  return new Date(ms).toISOString()
}

function readFirstNumber(
  value: RecordLike,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const found = asNumber(value[key])
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

function containsAnyKey(value: RecordLike, keys: string[]): boolean {
  return keys.some(key => value[key] !== undefined)
}

function capitalizeFirst(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value
}

function formatBucketLabel(value: string): string {
  if (!value) return 'MiniMax'
  const trimmed = value.trim()
  if (!trimmed) return 'MiniMax'
  if (/[A-Z]/.test(trimmed)) return trimmed
  return trimmed
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => capitalizeFirst(part.toLowerCase()))
    .join(' ')
}

function formatPlanType(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => capitalizeFirst(part.toLowerCase()))
    .join(' ')
}

type WindowSpec = {
  label: string
  percentKeys: string[]
  totalKeys: string[]
  remainingKeys: string[]
  usedKeys: string[]
  resetKeys: string[]
}

function normalizeWindowFromSpec(
  value: RecordLike,
  spec: WindowSpec,
): MiniMaxUsageWindow | undefined {
  const explicitPercent = readFirstNumber(value, spec.percentKeys)
  const total = readFirstNumber(value, spec.totalKeys)
  const remaining = readFirstNumber(value, spec.remainingKeys)
  const used = readFirstNumber(value, spec.usedKeys)

  let usedPercent: number | undefined
  if (explicitPercent !== undefined) {
    usedPercent = clampPercent(explicitPercent)
  } else if (
    total !== undefined &&
    total > 0 &&
    remaining !== undefined &&
    remaining <= total
  ) {
    usedPercent = clampPercent(((total - remaining) / total) * 100)
  } else if (total !== undefined && total > 0 && used !== undefined) {
    usedPercent = clampPercent((used / total) * 100)
  }

  if (usedPercent === undefined) {
    return undefined
  }

  return {
    label: spec.label,
    usedPercent,
    remaining,
    total,
    resetsAt: toIsoDate(
      spec.resetKeys
        .map(key => value[key])
        .find(candidate => candidate !== undefined),
    ),
  }
}

function normalizeGenericWindow(value: RecordLike): MiniMaxUsageWindow | undefined {
  const label =
    asString(value.label) ??
    asString(value.name) ??
    asString(value.window_name) ??
    asString(value.windowName) ??
    'Limit'

  return normalizeWindowFromSpec(value, {
    label,
    percentKeys: [
      'used_percent',
      'usedPercent',
      'utilization',
      'usage_percentage',
      'usagePercentage',
    ],
    totalKeys: ['total', 'quota', 'limit', 'max', 'entitlement'],
    remainingKeys: ['remaining', 'remain', 'remains', 'left'],
    usedKeys: ['used', 'usage', 'consumed'],
    resetKeys: ['resets_at', 'reset_at', 'resetsAt', 'resetAt'],
  })
}

const WINDOW_SPECS: WindowSpec[] = [
  {
    label: '5h limit',
    percentKeys: ['interval_used_percent', 'intervalUsedPercent'],
    totalKeys: [
      'max_interval_usage_count',
      'maxIntervalUsageCount',
      'interval_quota',
      'intervalQuota',
      'interval_limit',
      'intervalLimit',
    ],
    remainingKeys: [
      'current_interval_usage_count',
      'currentIntervalUsageCount',
      'interval_remaining',
      'intervalRemaining',
      'remaining_interval_usage_count',
      'remainingIntervalUsageCount',
    ],
    usedKeys: [
      'interval_used',
      'intervalUsed',
      'used_interval_usage_count',
      'usedIntervalUsageCount',
    ],
    resetKeys: [
      'interval_resets_at',
      'intervalResetsAt',
      'interval_reset_at',
      'intervalResetAt',
    ],
  },
  {
    label: 'Weekly limit',
    percentKeys: ['weekly_used_percent', 'weeklyUsedPercent'],
    totalKeys: [
      'max_weekly_usage_count',
      'maxWeeklyUsageCount',
      'weekly_quota',
      'weeklyQuota',
      'weekly_limit',
      'weeklyLimit',
    ],
    remainingKeys: [
      'current_weekly_usage_count',
      'currentWeeklyUsageCount',
      'weekly_remaining',
      'weeklyRemaining',
      'remaining_weekly_usage_count',
      'remainingWeeklyUsageCount',
    ],
    usedKeys: [
      'weekly_used',
      'weeklyUsed',
      'used_weekly_usage_count',
      'usedWeeklyUsageCount',
    ],
    resetKeys: [
      'weekly_resets_at',
      'weeklyResetsAt',
      'weekly_reset_at',
      'weeklyResetAt',
    ],
  },
  {
    label: 'Daily limit',
    percentKeys: ['daily_used_percent', 'dailyUsedPercent'],
    totalKeys: [
      'max_daily_usage_count',
      'maxDailyUsageCount',
      'daily_quota',
      'dailyQuota',
      'daily_limit',
      'dailyLimit',
    ],
    remainingKeys: [
      'current_daily_usage_count',
      'currentDailyUsageCount',
      'daily_remaining',
      'dailyRemaining',
      'remaining_daily_usage_count',
      'remainingDailyUsageCount',
    ],
    usedKeys: [
      'daily_used',
      'dailyUsed',
      'used_daily_usage_count',
      'usedDailyUsageCount',
    ],
    resetKeys: [
      'daily_resets_at',
      'dailyResetsAt',
      'daily_reset_at',
      'dailyResetAt',
    ],
  },
]

const SNAPSHOT_HINT_KEYS = [
  'used_percent',
  'usedPercent',
  'utilization',
  'usage_percentage',
  'usagePercentage',
  'total',
  'quota',
  'limit',
  'max',
  'entitlement',
  'remaining',
  'remain',
  'remains',
  'left',
  'current_interval_usage_count',
  'max_interval_usage_count',
  'current_weekly_usage_count',
  'max_weekly_usage_count',
  'current_daily_usage_count',
  'max_daily_usage_count',
]

function looksLikeSnapshotRecord(value: RecordLike): boolean {
  if (containsAnyKey(value, SNAPSHOT_HINT_KEYS)) {
    return true
  }
  return WINDOW_SPECS.some(
    spec =>
      containsAnyKey(value, spec.totalKeys) ||
      containsAnyKey(value, spec.remainingKeys) ||
      containsAnyKey(value, spec.usedKeys) ||
      containsAnyKey(value, spec.percentKeys),
  )
}

function normalizeSnapshot(
  value: unknown,
  fallbackName: string,
): MiniMaxUsageSnapshot | undefined {
  if (!isRecord(value)) return undefined

  const windows = WINDOW_SPECS.map(spec => normalizeWindowFromSpec(value, spec))
    .filter((window): window is MiniMaxUsageWindow => window !== undefined)

  if (windows.length === 0) {
    const generic = normalizeGenericWindow(value)
    if (generic) {
      windows.push(generic)
    }
  }

  if (windows.length === 0) {
    return undefined
  }

  const limitName =
    asString(value.limit_name) ??
    asString(value.limitName) ??
    asString(value.model_name) ??
    asString(value.modelName) ??
    asString(value.name) ??
    fallbackName

  return {
    limitName,
    windows,
  }
}

function normalizeSnapshotsFromValue(
  value: unknown,
  fallbackName = 'MiniMax',
): MiniMaxUsageSnapshot[] {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) =>
        normalizeSnapshot(entry, index === 0 ? fallbackName : `${fallbackName}-${index + 1}`),
      )
      .filter((snapshot): snapshot is MiniMaxUsageSnapshot => snapshot !== undefined)
  }

  if (!isRecord(value)) {
    return []
  }

  if (looksLikeSnapshotRecord(value)) {
    const snapshot = normalizeSnapshot(value, fallbackName)
    return snapshot ? [snapshot] : []
  }

  return Object.entries(value)
    .map(([key, entry]) => normalizeSnapshot(entry, key))
    .filter((snapshot): snapshot is MiniMaxUsageSnapshot => snapshot !== undefined)
}

function buildUnavailableResult(
  message = DEFAULT_MINIMAX_UNAVAILABLE_MESSAGE,
  planType?: string,
): MiniMaxUsageData {
  return {
    availability: 'unknown',
    planType,
    snapshots: [],
    message,
  }
}

export function normalizeMiniMaxUsagePayload(payload: unknown): MiniMaxUsageData {
  if (!isRecord(payload)) {
    return buildUnavailableResult()
  }

  const planType = formatPlanType(
    asString(payload.plan_type) ??
      asString(payload.planType) ??
      asString(payload.subscription_type) ??
      asString(payload.subscriptionType) ??
      asString(payload.plan_name) ??
      asString(payload.planName),
  )

  const candidates: unknown[] = [
    payload.data,
    payload.result,
    payload.remains,
    payload.usage,
    payload.quotas,
    payload.models,
    isRecord(payload.data) ? payload.data.models : undefined,
    isRecord(payload.data) ? payload.data.quotas : undefined,
    isRecord(payload.data) ? payload.data.remains : undefined,
  ]

  const snapshots = candidates
    .flatMap(candidate => normalizeSnapshotsFromValue(candidate))
    .filter((snapshot, index, all) => {
      const identity = `${snapshot.limitName}:${snapshot.windows.map(window => window.label).join('|')}`
      return (
        all.findIndex(
          candidate =>
            `${candidate.limitName}:${candidate.windows.map(window => window.label).join('|')}` ===
            identity,
        ) === index
      )
    })

  if (snapshots.length > 0) {
    return {
      availability: 'available',
      planType,
      snapshots,
    }
  }

  const directSnapshots = normalizeSnapshotsFromValue(payload)
  if (directSnapshots.length > 0) {
    return {
      availability: 'available',
      planType,
      snapshots: directSnapshots,
    }
  }

  return buildUnavailableResult(undefined, planType)
}

function buildRemainingText(window: MiniMaxUsageWindow): string | undefined {
  if (
    window.remaining === undefined ||
    window.total === undefined ||
    window.total <= 0
  ) {
    return undefined
  }

  return `${window.remaining}/${window.total} remaining`
}

export function buildMiniMaxUsageRows(
  snapshots: MiniMaxUsageSnapshot[],
): MiniMaxUsageRow[] {
  const rows: MiniMaxUsageRow[] = []

  for (const snapshot of snapshots) {
    const bucketLabel = formatBucketLabel(snapshot.limitName)
    const showPrefix = bucketLabel.toLowerCase() !== 'minimax'
    const combineSingleWindow = showPrefix && snapshot.windows.length === 1

    if (showPrefix && !combineSingleWindow) {
      rows.push({
        kind: 'text',
        label: `${bucketLabel} quota`,
        value: '',
      })
    }

    for (const window of snapshot.windows) {
      rows.push({
        kind: 'window',
        label: combineSingleWindow ? `${bucketLabel} ${window.label}` : window.label,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt,
        extraSubtext: buildRemainingText(window),
      })
    }
  }

  return rows
}

export function getMiniMaxUsageUrls(
  baseUrl = process.env.OPENAI_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL,
): string[] {
  let apiOrigin = 'https://api.minimax.io'
  let webOrigin = 'https://www.minimax.io'

  try {
    const parsed = new URL(baseUrl)
    apiOrigin = `${parsed.protocol}//${parsed.host}`
    if (parsed.host.includes('minimaxi.com')) {
      webOrigin = 'https://www.minimaxi.com'
    }
  } catch {
    // Keep defaults when the configured base URL is malformed.
  }

  return Array.from(
    new Set([
      new URL('/v1/token_plan/remains', webOrigin).toString(),
      new URL('/v1/token_plan/remains', apiOrigin).toString(),
      new URL('/v1/api/openplatform/coding_plan/remains', webOrigin).toString(),
      new URL('/v1/api/openplatform/coding_plan/remains', apiOrigin).toString(),
    ]),
  )
}

export async function fetchMiniMaxUsage(): Promise<MiniMaxUsageData> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'MiniMax auth is required. Set MINIMAX_API_KEY or OPENAI_API_KEY.',
    )
  }

  const usageUrls = getMiniMaxUsageUrls()
  const nonFatalFailures: Array<{ status: number; body: string }> = []
  let lastFatalError: Error | null = null

  for (const usageUrl of usageUrls) {
    let response: Response
    try {
      response = await fetch(usageUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': getClaudeCodeUserAgent(),
        },
        signal: AbortSignal.timeout(5000),
      })
    } catch (error) {
      logForDebugging(
        `[minimax] usage request failed for ${usageUrl}: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' },
      )
      lastFatalError =
        error instanceof Error ? error : new Error(String(error))
      continue
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      if ([400, 401, 403, 404].includes(response.status)) {
        nonFatalFailures.push({ status: response.status, body: errorBody })
        continue
      }
      lastFatalError = new Error(
        `MiniMax usage error ${response.status}: ${errorBody || 'unknown error'}`,
      )
      continue
    }

    const normalized = normalizeMiniMaxUsagePayload(await response.json())
    if (normalized.availability === 'available') {
      return normalized
    }
  }

  if (nonFatalFailures.length > 0) {
    const latest = nonFatalFailures[nonFatalFailures.length - 1]
    logForDebugging(
      `[minimax] usage endpoint returned non-fatal status ${latest.status}: ${latest.body}`,
      { level: 'warn' },
    )
    return buildUnavailableResult()
  }

  if (lastFatalError) {
    throw lastFatalError
  }

  return buildUnavailableResult()
}
