/**
 * Inert stub for memory shape telemetry.
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where
 * `feature('MEMORY_SHAPE_TELEMETRY')` is disabled. This module preserves
 * that behavior: nothing is logged and no import-time side effects occur.
 */

import type { MemoryScope } from '../utils/memoryFileDetection.js'
import type { MemoryHeader } from './memoryScan.js'

/**
 * Log the shape of a memory recall (candidate set vs. selected set).
 * Fires even on empty selection in the real implementation; inert: no-op.
 */
export function logMemoryRecallShape(
  _memories: readonly MemoryHeader[],
  _selected: readonly MemoryHeader[],
): void {
  // no-op
}

/**
 * Log the shape of a memory file write (Edit/Write tool against a memory
 * file). Inert: no-op.
 */
export function logMemoryWriteShape(
  _toolName: string,
  _toolInput: unknown,
  _filePath: string,
  _scope: MemoryScope,
): void {
  // no-op
}
