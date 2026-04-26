import {
  DEFAULT_MINIMAX_UNAVAILABLE_MESSAGE,
  type MiniMaxUsageData,
  type MiniMaxUsageRow,
  type MiniMaxUsageSnapshot,
  type MiniMaxUsageWindow,
} from './types.js'

type RecordLike = Record<string, unknown>

type WindowSpec = {
  label: string
  percentKeys: string[]
  remainingPercentKeys: string[]
  totalKeys: string[]
  remainingKeys: string[]
  usedKeys: string[]
  resetKeys: string[]
}

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

function toResetIsoDate(value: unknown, key: string): string | undefined {
  const numeric = asNumber(value)
  if (/remains?_time/i.test(key) && numeric !== undefined) {
    const ms = numeric > 604_800 ? numeric : numeric * 1000
    return new Date(Date.now() + ms).toISOString()
  }

  return toIsoDate(value)
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

function readResetTime(value: RecordLike, keys: string[]): string | undefined {
  for (const key of keys) {
    if (value[key] !== undefined) {
      return toResetIsoDate(value[key], key)
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

function normalizeWindowFromSpec(
  value: RecordLike,
  spec: WindowSpec,
): MiniMaxUsageWindow | undefined {
  const explicitUsedPercent = readFirstNumber(value, spec.percentKeys)
  const explicitRemainingPercent = readFirstNumber(
    value,
    spec.remainingPercentKeys,
  )
  const total = readFirstNumber(value, spec.totalKeys)
  const remaining = readFirstNumber(value, spec.remainingKeys)
  const used = readFirstNumber(value, spec.usedKeys)
  const derivedRemaining =
    total !== undefined && used !== undefined ? total - used : remaining

  let usedPercent: number | undefined
  if (total !== undefined && total > 0 && used !== undefined) {
    usedPercent = clampPercent((used / total) * 100)
  } else if (total !== undefined && total > 0 && remaining !== undefined) {
    usedPercent = clampPercent(((total - remaining) / total) * 100)
  } else if (explicitUsedPercent !== undefined) {
    usedPercent = clampPercent(explicitUsedPercent)
  } else if (explicitRemainingPercent !== undefined) {
    usedPercent = clampPercent(100 - explicitRemainingPercent)
  }

  if (usedPercent === undefined) {
    return undefined
  }

  return {
    label: spec.label,
    usedPercent,
    remaining: derivedRemaining,
    total,
    resetsAt: readResetTime(value, spec.resetKeys),
  }
}

function normalizeGenericWindow(
  value: RecordLike,
): MiniMaxUsageWindow | undefined {
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
    remainingPercentKeys: [
      'usage_percent',
      'usagePercent',
      'remaining_percent',
      'remainingPercent',
      'percent_remaining',
      'percentRemaining',
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
    remainingPercentKeys: [
      'usage_percent',
      'usagePercent',
      'interval_remaining_percent',
      'intervalRemainingPercent',
    ],
    totalKeys: [
      'current_interval_total_count',
      'currentIntervalTotalCount',
      'max_interval_usage_count',
      'maxIntervalUsageCount',
      'interval_quota',
      'intervalQuota',
      'interval_limit',
      'intervalLimit',
    ],
    remainingKeys: [
      'current_interval_remaining_count',
      'currentIntervalRemainingCount',
      'current_interval_remains_count',
      'currentIntervalRemainsCount',
      'interval_remaining',
      'intervalRemaining',
      'remaining_interval_usage_count',
      'remainingIntervalUsageCount',
    ],
    usedKeys: [
      'current_interval_usage_count',
      'currentIntervalUsageCount',
      'interval_used',
      'intervalUsed',
      'current_interval_used_count',
      'currentIntervalUsedCount',
      'used_interval_usage_count',
      'usedIntervalUsageCount',
    ],
    resetKeys: [
      'end_time',
      'endTime',
      'interval_resets_at',
      'intervalResetsAt',
      'interval_reset_at',
      'intervalResetAt',
      'remains_time',
      'remainsTime',
    ],
  },
  {
    label: 'Weekly limit',
    percentKeys: ['weekly_used_percent', 'weeklyUsedPercent'],
    remainingPercentKeys: [
      'weekly_remaining_percent',
      'weeklyRemainingPercent',
    ],
    totalKeys: [
      'max_weekly_usage_count',
      'maxWeeklyUsageCount',
      'weekly_quota',
      'weeklyQuota',
      'weekly_limit',
      'weeklyLimit',
    ],
    remainingKeys: [
      'weekly_remaining',
      'weeklyRemaining',
      'remaining_weekly_usage_count',
      'remainingWeeklyUsageCount',
    ],
    usedKeys: [
      'current_weekly_usage_count',
      'currentWeeklyUsageCount',
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
    remainingPercentKeys: ['daily_remaining_percent', 'dailyRemainingPercent'],
    totalKeys: [
      'max_daily_usage_count',
      'maxDailyUsageCount',
      'daily_quota',
      'dailyQuota',
      'daily_limit',
      'dailyLimit',
    ],
    remainingKeys: [
      'daily_remaining',
      'dailyRemaining',
      'remaining_daily_usage_count',
      'remainingDailyUsageCount',
    ],
    usedKeys: [
      'current_daily_usage_count',
      'currentDailyUsageCount',
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
  'usage_percent',
  'usagePercent',
  'current_interval_total_count',
  'current_interval_usage_count',
  'current_interval_remaining_count',
  'current_interval_remains_count',
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
        normalizeSnapshot(
          entry,
          index === 0 ? fallbackName : `${fallbackName}-${index + 1}`,
        ),
      )
      .filter(
        (snapshot): snapshot is MiniMaxUsageSnapshot => snapshot !== undefined,
      )
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
    payload.model_remains,
    payload.modelRemains,
    payload.remains,
    payload.usage,
    payload.quotas,
    payload.models,
    isRecord(payload.data) ? payload.data.model_remains : undefined,
    isRecord(payload.data) ? payload.data.modelRemains : undefined,
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
        label: combineSingleWindow
          ? `${bucketLabel} ${window.label}`
          : window.label,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt,
        extraSubtext: buildRemainingText(window),
      })
    }
  }

  return rows
}
