/**
 * No-op stub for telemetry attributes.
 * getTelemetryAttributes returns an empty object; no ATTR_ constants.
 * No @opentelemetry imports.
 */

export function getTelemetryAttributes(): Record<string, unknown> {
	return {}
}