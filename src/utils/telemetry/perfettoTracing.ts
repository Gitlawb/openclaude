/**
 * No-op stub for Perfetto tracing.
 * All tracing functions are no-ops; all boolean checks return false.
 * No @opentelemetry imports.
 */

export type TraceEventPhase = 'B' | 'E' | 'I' | 'X'

export type TraceEvent = {
	name: string
	phase: TraceEventPhase
	timestamp: number
	pid: number
	tid: number
	args?: Record<string, unknown>
	id?: string
}

export function initializePerfettoTracing(): void {}

export function isPerfettoTracingEnabled(): boolean {
	return false
}

export function registerAgent(
	_agentId: string,
	_name: string,
	_parentSessionId?: string,
): void {}

export function unregisterAgent(_agentId: string): void {}

export function startLLMRequestPerfettoSpan(_args: {
	model: string
	promptId: string
	parentSessionId?: string
}): string {
	return ''
}

export function endLLMRequestPerfettoSpan(
	_spanId: string,
	_args?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number },
): void {}

export function startToolPerfettoSpan(_args: {
	toolName: string
	agentId?: string
	parentSessionId?: string
}): string {
	return ''
}

export function endToolPerfettoSpan(_spanId: string): void {}

export function startUserInputPerfettoSpan(_context?: string): string {
	return ''
}

export function endUserInputPerfettoSpan(_spanId: string): void {}

export function emitPerfettoInstant(
	_name: string,
	_args?: Record<string, unknown>,
): void {}

export function emitPerfettoCounter(
	_name: string,
	_value: number,
	_args?: Record<string, unknown>,
): void {}

export function startInteractionPerfettoSpan(_userPrompt?: string): string {
	return ''
}

export function endInteractionPerfettoSpan(_spanId: string): void {}

export function getPerfettoEvents(): TraceEvent[] {
	return []
}

export function resetPerfettoTracer(): void {}

export async function triggerPeriodicWriteForTesting(): Promise<void> {}

export function evictStaleSpansForTesting(): void {}

export const MAX_EVENTS_FOR_TESTING = 0

export function evictOldestEventsForTesting(): void {}