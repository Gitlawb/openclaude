import {
  DEFAULT_CLINEPASS_UNAVAILABLE_MESSAGE,
  type ClinePassUsageData,
  type ClinePassUsageRow,
  type ClinePassUsageWindow,
} from './types.js'

type RecordLike = Record<string, unknown>

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
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
  }
  return undefined
}

const WINDOW_TYPE_LABELS: Record<string, string> = {
  five_hour: '5-Hour Limit',
  weekly: 'Weekly Limit',
  monthly: 'Monthly Limit',
}

function normalizeWindow(raw: unknown): ClinePassUsageWindow | undefined {
  if (!isRecord(raw)) return undefined

  const type = asString(raw.type) ?? 'unknown'
  const percentUsed = asNumber(raw.percentUsed)
  if (percentUsed === undefined) return undefined

  const label = WINDOW_TYPE_LABELS[type] ?? type
  const resetsAt = toIsoDate(raw.resetsAt)

  return {
    label,
    type,
    usedPercent: clampPercent(percentUsed),
    resetsAt,
  }
}

function normalizeLimitsArray(limits: unknown): ClinePassUsageWindow[] {
  if (!Array.isArray(limits)) return []
  return limits
    .map(normalizeWindow)
    .filter((w): w is ClinePassUsageWindow => w !== undefined)
}

export function normalizeClinePassUsagePayload(
  payload: unknown,
): ClinePassUsageData {
  if (!isRecord(payload)) {
    return {
      availability: 'unknown',
      windows: [],
      message: DEFAULT_CLINEPASS_UNAVAILABLE_MESSAGE,
    }
  }

  const data = isRecord(payload.data) ? payload.data : payload
  const limits =
    isRecord(data) && Array.isArray(data.limits)
      ? data.limits
      : []

  const windows = normalizeLimitsArray(limits)

  if (windows.length === 0) {
    return {
      availability: 'unknown',
      windows: [],
      message: DEFAULT_CLINEPASS_UNAVAILABLE_MESSAGE,
    }
  }

  const planName = asString(
    payload.planName ??
      payload.plan_name ??
      data.planName ??
      data.plan_name,
  )

  return {
    availability: 'available',
    planName,
    windows,
  }
}

export function buildClinePassUsageRows(
  windows: ClinePassUsageWindow[],
): ClinePassUsageRow[] {
  const rows: ClinePassUsageRow[] = []

  for (const window of windows) {
    rows.push({
      kind: 'window',
      label: window.label,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt,
    })
  }

  return rows
}
