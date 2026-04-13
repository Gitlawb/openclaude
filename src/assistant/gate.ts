/**
 * KAIROS runtime gate for the open build.
 *
 * In the Anthropic-internal build this checks the GrowthBook `tengu_kairos`
 * feature flag (a fleet-level kill switch). In the open build the user has
 * already opted in via settings.json { assistant: true }, so we default to
 * true. The GrowthBook stub returns defaultValue directly; with PR #639's
 * local feature flag overrides, users can set { "tengu_kairos": false } in
 * ~/.claude/feature-flags.json to disable.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

export async function isKairosEnabled(): Promise<boolean> {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos', true) as boolean
}
