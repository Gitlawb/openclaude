/**
 * No-op stub for telemetry events.
 * logOTelEvent does nothing; redactIfDisabled always redacts.
 * No @opentelemetry imports.
 */

export async function logOTelEvent(
	_eventName: string,
	_metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
	// no-op
}

export function redactIfDisabled(_content: string): string {
	return '<REDACTED>'
}