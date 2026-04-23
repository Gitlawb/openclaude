/**
 * Todo / task reminder delta — announce only changes to the todo
 * snapshot between turns (added, status-changed, removed), instead of
 * re-emitting the full list every time the nag fires.
 *
 * WHY: `getTodoReminderAttachments` / `getTaskReminderAttachments`
 * (src/utils/attachments.ts) re-render the full todo list into a
 * `<system-reminder>` every time the reminder fires — even when the
 * list hasn't changed since the previous reminder. On a long session
 * with dozens of todos this adds up. The delta lets the reminder text
 * stay minimal ("still 7 tasks, 3 in progress — details unchanged")
 * on the common path while still announcing full state on the first
 * reminder and on actual drift.
 *
 * Mirrors the pattern of:
 *   - `src/utils/mcpInstructionsDelta.ts`
 *   - `src/utils/toolSearch.ts` (`getDeferredToolsDelta`)
 *   - `src/utils/attachments.ts` (`getAgentListingDeltaAttachment`)
 *
 * Identity key is the rendered todo content (todo list) or task
 * subject/id (v2 task system). Status drift on an existing item is
 * announced as an update, not a remove+add — the caller's renderer
 * decides how to present it.
 */

import { logEvent } from '../services/analytics/index.js'

/** A normalized todo/task snapshot item, provider-agnostic. */
export type TodoSnapshotItem = {
  /** Stable identity — subject for v1 todos, `#${id}` for v2 tasks. */
  id: string
  /** Current status (pending / in_progress / completed / other). */
  status: string
  /** Display text rendered to the model. */
  text: string
}

export type TodoReminderDelta = {
  added: TodoSnapshotItem[]
  /** Items whose status transitioned since the last reminder. */
  statusChanged: Array<{
    id: string
    priorStatus: string
    newStatus: string
    text: string
  }>
  /** Items previously announced that are no longer in the list. */
  removedIds: string[]
  /** True when this is the first reminder of the session. */
  isInitial: boolean
  /** Full snapshot (id → status) — future turns diff against this. */
  snapshot: Array<{ id: string; status: string }>
}

type ScannableMessage = {
  type: string
  attachment?: {
    type: string
    snapshot?: Array<{ id: string; status: string }>
  }
}

/**
 * Diff current todo snapshot against last announced snapshot in the
 * transcript. Returns `null` when unchanged.
 *
 * Pure function: caller builds the `current` snapshot from whichever
 * source (v1 `TodoList` or v2 `Task[]`).
 */
export function getTodoReminderDelta(
  current: readonly TodoSnapshotItem[],
  messages: readonly ScannableMessage[],
): TodoReminderDelta | null {
  // Reconstruct "last announced" state from prior todo_reminder_delta
  // attachments. Each delta carries a full snapshot, so the most recent
  // one alone suffices — but we fold through the list ("last-write-wins")
  // for symmetry with the other delta scanners.
  const announcedStatusById = new Map<string, string>()
  let hasPriorDelta = false
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    if (msg.attachment?.type !== 'todo_reminder_delta') continue
    hasPriorDelta = true
    announcedStatusById.clear()
    for (const priorItem of msg.attachment.snapshot ?? []) {
      announcedStatusById.set(priorItem.id, priorItem.status)
    }
  }

  // Index the current snapshot by id for O(1) lookup during the diff.
  const currentItemById = new Map<string, TodoSnapshotItem>()
  for (const item of current) {
    currentItemById.set(item.id, item)
  }

  // Diff: new id → added; same id, different status → statusChanged;
  // previously-announced id missing from current → removed.
  const added: TodoSnapshotItem[] = []
  const statusChanged: Array<{
    id: string
    priorStatus: string
    newStatus: string
    text: string
  }> = []
  for (const item of current) {
    const priorStatus = announcedStatusById.get(item.id)
    if (priorStatus === undefined) {
      added.push(item)
    } else if (priorStatus !== item.status) {
      statusChanged.push({
        id: item.id,
        priorStatus,
        newStatus: item.status,
        text: item.text,
      })
    }
  }

  const removedIds: string[] = []
  for (const id of announcedStatusById.keys()) {
    if (!currentItemById.has(id)) removedIds.push(id)
  }

  if (
    added.length === 0 &&
    statusChanged.length === 0 &&
    removedIds.length === 0 &&
    hasPriorDelta
  ) {
    return null
  }

  // Deterministic output across platforms — id-ordered.
  added.sort((a, b) => a.id.localeCompare(b.id))
  statusChanged.sort((a, b) => a.id.localeCompare(b.id))
  removedIds.sort()
  const snapshot = current
    .map(item => ({ id: item.id, status: item.status }))
    .sort((a, b) => a.id.localeCompare(b.id))

  logEvent('tengu_todo_reminder_delta', {
    addedCount: added.length,
    statusChangedCount: statusChanged.length,
    removedCount: removedIds.length,
    priorAnnouncedCount: announcedStatusById.size,
    isInitial: !hasPriorDelta,
  })

  return {
    added,
    statusChanged,
    removedIds,
    isInitial: !hasPriorDelta,
    snapshot,
  }
}
