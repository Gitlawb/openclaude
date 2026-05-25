/**
 * No-op stub for session tracing.
 * All spans are no-op objects; all boolean checks return false.
 * No @opentelemetry imports.
 */

export type Span = {
	spanContext(): { traceId: string; spanId: string; traceFlags: number }
	setAttribute(key: string, value: string | number | boolean): Span
	setAttributes(attrs: Record<string, string | number | boolean>): Span
	setStatus(status: { code: number; message?: string }): Span
	end(): void
	recordException(exception: Error | string, attributes?: Record<string, unknown>): void
	addEvent(name: string, attributes?: Record<string, string | number | boolean>): Span
	isRecording(): boolean
}

const noopSpan: Span = {
	spanContext() {
		return { traceId: '', spanId: '', traceFlags: 0 }
	},
	setAttribute() {
		return noopSpan
	},
	setAttributes() {
		return noopSpan
	},
	setStatus() {
		return noopSpan
	},
	end() {},
	recordException() {},
	addEvent() {
		return noopSpan
	},
	isRecording() {
		return false
	},
}

export type LLMRequestNewContext = Record<string, unknown>

export function isBetaTracingEnabled(): boolean {
	return false
}

export function isEnhancedTelemetryEnabled(): boolean {
	return false
}

export function startInteractionSpan(): Span {
	return noopSpan
}

export function endInteractionSpan() {}

export function startLLMRequestSpan(): Span {
	return noopSpan
}

export function endLLMRequestSpan() {}

export function startToolSpan(): Span {
	return noopSpan
}

export function startToolBlockedOnUserSpan(): Span {
	return noopSpan
}

export function endToolBlockedOnUserSpan() {}

export function startToolExecutionSpan(): Span {
	return noopSpan
}

export function endToolExecutionSpan() {}

export function endToolSpan() {}

export function addToolContentEvent() {}

export function getCurrentSpan(): null {
	return null
}

export async function executeInSpan<T>(
	_spanName: string,
	fn: (span: Span) => Promise<T>,
	_attributes?: Record<string, string | number | boolean>,
): Promise<T> {
	return fn(noopSpan)
}

export function startHookSpan(): Span {
	return noopSpan
}

export function endHookSpan() {}