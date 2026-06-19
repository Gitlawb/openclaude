import type { Message } from '../../types/message.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { getAutoCompactThreshold } from './autoCompact.js'

// Prompt compact on resume when the conversation exceeds this fraction of the
// auto-compact threshold. Matches Claude Code's behavior of offering compaction
// before the session is already at the limit.
const RESUME_COMPACT_THRESHOLD_FRACTION = 0.7

/**
 * Decide whether to offer compaction when resuming a session.
 *
 * Returns false for empty/tiny sessions, non-interactive sessions, and when
 * the token count is below the threshold.
 */
export function shouldPromptCompactOnResume(
  messages: Message[],
  model: string,
  isNonInteractiveSession: boolean,
): boolean {
  if (isNonInteractiveSession) {
    return false
  }

  if (messages.length === 0) {
    return false
  }

  const tokenCount = tokenCountWithEstimation(messages)
  const threshold = getAutoCompactThreshold(model) * RESUME_COMPACT_THRESHOLD_FRACTION

  return tokenCount >= threshold
}
