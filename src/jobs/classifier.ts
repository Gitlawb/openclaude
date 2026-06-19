/**
 * Inert stub for the job classifier (template/job-directory workflows).
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where `feature('TEMPLATES')` is
 * disabled. This module preserves that behavior: no classification runs,
 * no state files are written, and no import-time side effects occur.
 */

import type { AssistantMessage } from '../types/message.js'

/**
 * Classify the turn's assistant activity and write job state into
 * `$CLAUDE_JOB_DIR`. Inert: resolves immediately without writing anything.
 */
export async function classifyAndWriteState(
  _jobDir: string,
  _assistantMessages: AssistantMessage[],
): Promise<void> {
  // no-op
}
