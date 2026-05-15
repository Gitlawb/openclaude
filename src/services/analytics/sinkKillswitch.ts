/**
 * No-op sink killswitch — all sinks are effectively "not killed" since
 * the analytics subsystem is fully disabled.
 */

export type SinkName = 'datadog' | 'firstParty'

/** Returns false — no sink is killed because analytics is disabled entirely. */
export function isSinkKilled(_sink: SinkName): boolean {
	return false
}