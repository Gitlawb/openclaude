// Stub — sessionTranscript not included in source snapshot (feature-gated).
// All call sites are behind feature('KAIROS'), which resolves this module to
// a noop at bundle time; these inert implementations preserve behavior.
import type { Message } from '../../types/message.js'

/**
 * Write a reduced transcript segment for the given messages (assistant
 * mode). Fire-and-forget at call sites. No-op in this snapshot.
 */
export async function writeSessionTranscriptSegment(
  _messages: Message[],
): Promise<void> {}

/**
 * Flush yesterday's transcript to the per-day file when the local date
 * changes mid-session. No-op in this snapshot.
 */
export function flushOnDateChange(
  _messages: Message[],
  _currentDate: string,
): void {}
