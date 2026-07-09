/**
 * Context budget helpers for autonomy / local-model sessions.
 * Tightens tool-result persistence thresholds so Ollama and small-context
 * models spend less context on huge Bash/Grep dumps.
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
} from '../../constants/toolLimits.js'

/** Default caps when autonomy maskToolResults is active (tighter than global 50k/200k) */
export const AUTONOMY_DEFAULT_MAX_TOOL_RESULT_CHARS = 20_000
export const AUTONOMY_DEFAULT_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 80_000

function loadAutonomySettings(): {
  enabled: boolean
  maskToolResults?: boolean
  maxToolResultChars?: number
  maxToolResultsPerMessageChars?: number
} {
  if (process.env.OPENCLAUDE_MASK_TOOL_RESULTS === '0') {
    return { enabled: false }
  }

  const envCaps = {
    maxToolResultChars: parsePositiveInt(
      process.env.OPENCLAUDE_MAX_TOOL_RESULT_CHARS,
    ),
    maxToolResultsPerMessageChars: parsePositiveInt(
      process.env.OPENCLAUDE_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
    ),
  }

  if (isEnvTruthy(process.env.OPENCLAUDE_MASK_TOOL_RESULTS)) {
    return {
      enabled: true,
      maskToolResults: true,
      ...envCaps,
    }
  }

  // Autonomy env alone is enough to enable masking (open / local default)
  if (isEnvTruthy(process.env.OPENCLAUDE_AUTONOMY)) {
    return {
      enabled: true,
      maskToolResults: true,
      ...envCaps,
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInitialSettings } =
      require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isAutonomyEnabled } =
      require('./routePolicy.js') as typeof import('./routePolicy.js')
    const settings = getInitialSettings()
    if (!isAutonomyEnabled(settings)) {
      return { enabled: false }
    }
    return {
      enabled: true,
      maskToolResults: settings.autonomy?.maskToolResults,
      maxToolResultChars:
        settings.autonomy?.maxToolResultChars ?? envCaps.maxToolResultChars,
      maxToolResultsPerMessageChars:
        settings.autonomy?.maxToolResultsPerMessageChars ??
        envCaps.maxToolResultsPerMessageChars,
    }
  } catch {
    return { enabled: false }
  }
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return !isNaN(n) && n > 0 ? n : undefined
}

/**
 * Whether content-replacement / tool-result budget should run even when
 * GrowthBook hawthorn flag is off (open builds).
 */
export function shouldEnableAutonomyToolResultMasking(): boolean {
  const a = loadAutonomySettings()
  if (!a.enabled) return false
  // Default ON when autonomy is on unless explicitly false
  return a.maskToolResults !== false
}

/**
 * Per-tool persistence threshold under autonomy (or undefined to keep global).
 */
export function getAutonomyPersistenceThreshold(
  declaredMaxResultSizeChars: number,
): number | undefined {
  if (!shouldEnableAutonomyToolResultMasking()) return undefined
  if (!Number.isFinite(declaredMaxResultSizeChars)) {
    return declaredMaxResultSizeChars
  }
  const a = loadAutonomySettings()
  const cap =
    a.maxToolResultChars ?? AUTONOMY_DEFAULT_MAX_TOOL_RESULT_CHARS
  return Math.min(
    declaredMaxResultSizeChars,
    cap,
    DEFAULT_MAX_RESULT_SIZE_CHARS,
  )
}

/**
 * Per-message aggregate budget under autonomy (or undefined to keep global).
 */
export function getAutonomyPerMessageBudgetLimit(): number | undefined {
  if (!shouldEnableAutonomyToolResultMasking()) return undefined
  const a = loadAutonomySettings()
  const cap =
    a.maxToolResultsPerMessageChars ??
    AUTONOMY_DEFAULT_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS
  return Math.min(cap, MAX_TOOL_RESULTS_PER_MESSAGE_CHARS)
}
