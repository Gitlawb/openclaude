/**
 * No-op Datadog client — all tracking is disabled.
 *
 * Events are silently discarded. No data is sent to Datadog.
 */

/** No-op — nothing to shut down. */
export function shutdownDatadog(): void {}