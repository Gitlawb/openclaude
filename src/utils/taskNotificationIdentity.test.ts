import { describe, expect, test } from 'bun:test'
import {
  getTaskNotificationDedupKey,
  parseTaskNotificationTaskId,
} from './taskNotificationIdentity.js'

function taskNotification(taskId: string, summary: string): string {
  return `<task-notification>
<task-id>${taskId}</task-id>
<output-file>/tmp/${taskId}.jsonl</output-file>
<status>completed</status>
<summary>${summary}</summary>
</task-notification>`
}

describe('task notification identity', () => {
  test('parses the embedded task id from notification payloads', () => {
    expect(parseTaskNotificationTaskId(taskNotification('sabc1234', 'done'))).toBe(
      'sabc1234',
    )
    expect(parseTaskNotificationTaskId('no task id here')).toBeUndefined()
  })

  test('dedup keys stay distinct when summary text matches', () => {
    const summary = 'Background session "work" completed'
    const first = taskNotification('s1111111', summary)
    const second = taskNotification('s2222222', summary)

    expect(getTaskNotificationDedupKey(first)).toBe('s1111111')
    expect(getTaskNotificationDedupKey(second)).toBe('s2222222')
    expect(getTaskNotificationDedupKey(first)).not.toBe(
      getTaskNotificationDedupKey(second),
    )
  })

  test('falls back to full content when no task id is present', () => {
    const payload = '<task-notification><summary>hook</summary></task-notification>'
    expect(getTaskNotificationDedupKey(payload)).toBe(payload)
  })
})
