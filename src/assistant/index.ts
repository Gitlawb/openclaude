/**
 * Assistant mode (KAIROS-gated) entry points.
 *
 * The closed-source implementation latches assistant mode, pre-seeds an
 * in-process team, and contributes a system-prompt addendum. This
 * open-source build ships inert no-ops: the KAIROS feature flag is
 * disabled, isAssistantMode() always reports false, and the remaining
 * functions return honest empty values.
 */

import type { AppState } from '../state/AppStateStore.js'

/** Whether this process is running as an assistant-mode session. Always false. */
export function isAssistantMode(): boolean {
  return false
}

/**
 * --assistant (Agent SDK daemon mode): force the assistant latch without
 * re-checking entitlement. No-op in this build.
 */
export function markAssistantForced(): void {}

/** Whether the assistant latch was forced via --assistant. Always false. */
export function isAssistantForced(): boolean {
  return false
}

/**
 * Pre-seed an in-process team so Agent(name) spawns teammates without
 * TeamCreate. Returns no team context in this build.
 */
export async function initializeAssistantTeam(): Promise<
  AppState['teamContext'] | undefined
> {
  return undefined
}

/** System-prompt addendum for assistant-mode sessions. Empty in this build. */
export function getAssistantSystemPromptAddendum(): string {
  return ''
}

/**
 * How assistant mode was activated for this session (telemetry label,
 * e.g. forced via --assistant vs. entitlement gate). Undefined in this
 * build — assistant mode never activates.
 */
export function getAssistantActivationPath(): string | undefined {
  return undefined
}
