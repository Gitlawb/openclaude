/**
 * gitStatus delta — inject on turn 1 only.
 *
 * WHY: `getGitStatus` in `src/context.ts` explicitly documents its
 * output as "a snapshot in time, and will not update during the
 * conversation." Today that snapshot is re-appended to every system
 * prompt via `appendSystemContext` (src/utils/api.ts:486), costing
 * bytes on every request for content that cannot change.
 *
 * Since the snapshot is immutable by design, the scanner's job is
 * simpler than the other deltas: if any prior `git_status_delta`
 * attachment exists in the transcript, do nothing; otherwise emit the
 * full snapshot once.
 *
 * Mirrors the pattern of:
 *   - `src/utils/mcpInstructionsDelta.ts`
 *   - `src/utils/toolSearch.ts` (`getDeferredToolsDelta`)
 *   - `src/utils/attachments.ts` (`getAgentListingDeltaAttachment`)
 *
 * Complementary to the other three Phase-2 deltas (`claudeMdDelta`,
 * `memoryDelta`, `todoReminderDelta`): together they cover the static
 * context that was previously re-serialized every turn.
 */

import { logEvent } from '../services/analytics/index.js'

/**
 * Key inside the system-context object (see `getSystemContext` in
 * src/context.ts) that this delta replaces when dedup is active.
 * `api.ts::filterStaticDedupKeys` reads this to know which key to strip
 * from `appendSystemContext`, avoiding double-announce.
 */
export const GIT_STATUS_CONTEXT_KEY = 'gitStatus' as const

export type GitStatusDelta = {
  /** Full status snapshot — emitted once per session (turn 1). */
  content: string
}

type ScannableMessage = {
  type: string
  attachment?: { type: string }
}

/**
 * Emit the gitStatus attachment only when no prior `git_status_delta`
 * exists in the transcript. Returns `null` on any subsequent turn.
 *
 * Pure function: all state is passed in. The caller owns fetching the
 * current gitStatus string (via `getGitStatus` or the cached
 * `systemContext.gitStatus`). Passing `null`/empty is a no-op.
 */
export function getGitStatusDelta(
  currentGitStatus: string | null | undefined,
  messages: readonly ScannableMessage[],
): GitStatusDelta | null {
  if (!currentGitStatus) return null

  let priorAttachmentCount = 0
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    if (msg.attachment?.type === 'git_status_delta') {
      priorAttachmentCount++
    }
  }

  // Already announced — subsequent turns are a no-op. The snapshot is
  // immutable by design (see getGitStatus in src/context.ts).
  if (priorAttachmentCount > 0) return null

  logEvent('openclaude_git_status_delta', {
    emitted: true,
    contentLength: currentGitStatus.length,
  })

  return { content: currentGitStatus }
}
