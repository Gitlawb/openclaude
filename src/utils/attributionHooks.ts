/**
 * Commit-attribution tracking hooks (COMMIT_ATTRIBUTION-gated, internal-only).
 *
 * The closed-source implementation watches file edits and bash git activity
 * to attribute committed lines to Claude vs. the user. This open-source
 * build ships inert no-ops: the feature flag is disabled, and these
 * functions keep the importers (src/setup.ts, /clear cache reset,
 * post-compact cleanup) typechecking without any runtime behavior.
 */

/** Register attribution tracking hooks. No-op in this build. */
export function registerAttributionHooks(): void {}

/** Clear attribution caches (file content cache, pending bash states). No-op. */
export function clearAttributionCaches(): void {}

/** Sweep stale entries from the attribution file content cache. No-op. */
export function sweepFileContentCache(): void {}
