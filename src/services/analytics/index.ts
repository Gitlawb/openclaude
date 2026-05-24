/**
 * No-op analytics service — events are silently discarded.
 *
 * This module provides the public API for analytics event logging,
 * satisfying all import sites without sending any data.
 */

/**
 * Marker type for verifying analytics metadata doesn't contain sensitive data.
 *
 * Usage: `myString as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

/**
 * Marker type for values routed to PII-tagged proto columns.
 *
 * Usage: `rawName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED`
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

/**
 * Strip `_PROTO_*` keys from a payload.
 * No-op in this stub — returns the input unchanged when no _PROTO_ keys present.
 */
export function stripProtoFields<V>(
	metadata: Record<string, V>,
): Record<string, V> {
	// Return a copy with _PROTO_ keys removed (no-op if none present)
	const hasProtoKey = Object.keys(metadata).some((k) => k.startsWith('_PROTO_'))
	if (!hasProtoKey) return metadata
	const result: Record<string, V> = { ...metadata }
	for (const key of Object.keys(result)) {
		if (key.startsWith('_PROTO_')) {
			delete result[key]
		}
	}
	return result
}

/**
 * Analytics sink interface — no consumers in the no-op build,
 * but kept for type compatibility.
 */
export type AnalyticsSink = {
	logEvent: (eventName: string, metadata: { [key: string]: boolean | number | undefined }) => void
	logEventAsync: (eventName: string, metadata: { [key: string]: boolean | number | undefined }) => Promise<void>
}

/** No-op — there is no sink to attach. */
export function attachAnalyticsSink(_sink: AnalyticsSink): void {}

/**
 * Log an event — silently discarded.
 */
export function logEvent(
	_eventName: string,
	_metadata?: { [key: string]: boolean | number | undefined },
): void {
	// No-op: events are discarded
}

/**
 * Log an event asynchronously — silently discarded.
 */
export async function logEventAsync(
	_eventName: string,
	_metadata?: { [key: string]: boolean | number | undefined },
): Promise<void> {
	// No-op: events are discarded
}

/** Reset for testing — no-op. */
export function _resetForTesting(): void {}