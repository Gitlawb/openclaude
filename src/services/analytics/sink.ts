/**
 * No-op analytics sink — all event routing is disabled.
 *
 * With Datadog and 1P event logging stubbed out, the sink
 * has nothing to route to.
 */

/** No-op — there are no gates to initialize. */
export function initializeAnalyticsGates(): void {}

/** No-op — there is no sink to initialize. */
export function initializeAnalyticsSink(): void {}