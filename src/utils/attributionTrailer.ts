/**
 * Inert stub for PR attribution trailer generation.
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where `feature('COMMIT_ATTRIBUTION')`
 * is disabled (it contains excluded strings, which is why callers reach it
 * via dynamic import). This module preserves that behavior: no trailers are
 * produced and no import-time side effects occur.
 */

import type { AttributionData, AttributionState } from './commitAttribution.js'

/**
 * Build git trailer lines for a PR body so attribution survives
 * squash-merge. Inert: always returns an empty list.
 */
export function buildPRTrailers(
  _attributionData: AttributionData,
  _attributionState: AttributionState,
): string[] {
  return []
}
