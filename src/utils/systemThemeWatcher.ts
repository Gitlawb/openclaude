/**
 * Inert stub for the live terminal theme watcher (OSC 11 polling).
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where `feature('AUTO_THEME')` is
 * disabled (callers reach it via dynamic import so it dead-code-eliminates).
 * This module preserves that behavior: the terminal is never polled, the
 * callback never fires, and no import-time side effects occur.
 */

import type { TerminalQuerier } from '../ink/terminal-querier.js'
import type { SystemTheme } from './systemTheme.js'

/**
 * Watch the terminal's background color for live light/dark changes while
 * the 'auto' theme is active. Inert: never invokes `onThemeChange`.
 *
 * @returns An unsubscribe function (no-op).
 */
export function watchSystemTheme(
  _querier: TerminalQuerier,
  _onThemeChange: (theme: SystemTheme) => void,
): () => void {
  return () => {}
}
