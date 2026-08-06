import { TASK_ID_TAG } from '../constants/xml.js'

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
