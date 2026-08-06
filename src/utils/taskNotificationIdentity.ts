import { TASK_ID_TAG } from '../constants/xml.js'
import type { Message } from '../types/message.js'

const TASK_ID_PATTERN = new RegExp(
  `<${TASK_ID_TAG}>([^<]+)</${TASK_ID_TAG}>`,
)

/**
 * Parse the stable task id embedded in a task-notification payload.
 */
export function parseTaskNotificationTaskId(
  content: string,
): string | undefined {
  return content.match(TASK_ID_PATTERN)?.[1]
}

/**
 * Dedup key for task notifications. Prefer the embedded task id so distinct
 * tasks with identical summary text are not collapsed.
 */
export function getTaskNotificationDedupKey(content: string): string {
  return parseTaskNotificationTaskId(content) ?? content
}

export function dedupeQueuedTaskNotifications(
  settledMessages: readonly Message[],
  notificationMessages: readonly Message[],
): Message[] {
  const existingNotificationKeys = new Set<string>()
  for (const message of settledMessages) {
    if (
      message.type === 'attachment' &&
      message.attachment.type === 'queued_command' &&
      message.attachment.commandMode === 'task-notification' &&
      typeof message.attachment.prompt === 'string'
    ) {
      existingNotificationKeys.add(
        getTaskNotificationDedupKey(message.attachment.prompt),
      )
    }
  }
  return notificationMessages.filter(message => {
    if (
      message.type !== 'attachment' ||
      message.attachment.type !== 'queued_command' ||
      typeof message.attachment.prompt !== 'string'
    ) {
      return true
    }
    const key = getTaskNotificationDedupKey(message.attachment.prompt)
    if (existingNotificationKeys.has(key)) {
      return false
    }
    existingNotificationKeys.add(key)
    return true
  })
}
