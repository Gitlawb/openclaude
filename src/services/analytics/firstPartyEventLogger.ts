/**
 * No-op stub for 1P event logging.
 * All functions are no-ops; boolean checks return false;
 * getEventSamplingConfig returns {}; shouldSampleEvent returns null.
 * No @opentelemetry imports.
 */

export type EventSamplingConfig = {
	[eventName: string]: {
		sample_rate: number
	}
}

export type GrowthBookExperimentData = {
	experimentId: string
	variationId: number
	userAttributes?: Record<string, unknown>
	experimentMetadata?: Record<string, unknown>
}

export function initialize1PEventLogging() {}

export function logEventTo1P() {}

export function logGrowthBookExperimentTo1P() {}

export function is1PEventLoggingEnabled(): boolean {
	return false
}

export async function shutdown1PEventLogging(): Promise<void> {}

export async function reinitialize1PEventLoggingIfConfigChanged(): Promise<void> {}

export function getEventSamplingConfig(): EventSamplingConfig {
	return {}
}

export function shouldSampleEvent(): number | null {
	return null
}