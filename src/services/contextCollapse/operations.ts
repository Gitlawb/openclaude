import type { Message } from '../../types/message.js'

export function projectView(messages: Message[]): Message[] {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getCommitLogForProjection } =
    require('./index.js') as typeof import('./index.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const commits = getCommitLogForProjection()
  if (commits.length === 0) return messages

  let result = messages

  for (const c of commits) {
    const firstIdx = result.findIndex(m => m.uuid === c.firstArchivedUuid)
    const lastIdx = findLastIndex(result, m => m.uuid === c.lastArchivedUuid)

    if (firstIdx === -1 || lastIdx === -1 || firstIdx > lastIdx) continue

    // Reuse a stable timestamp from the replaced span so projectView stays a
    // pure, deterministic projection (identical input -> identical output).
    const placeholder: Message = {
      type: 'system',
      subtype: 'informational',
      content: c.summaryContent,
      uuid: c.summaryUuid,
      timestamp:
        result[firstIdx]?.timestamp ??
        result[lastIdx]?.timestamp ??
        new Date(0).toISOString(),
      isMeta: true,
      // Survives normalizeMessagesForAPI as a user message so the summary
      // reaches the model after the archived span is removed.
      isCollapseSummary: true,
    } as Message

    result = [
      ...result.slice(0, firstIdx),
      placeholder,
      ...result.slice(lastIdx + 1),
    ]
  }

  return result
}

function findLastIndex<T>(
  arr: T[],
  predicate: (item: T) => boolean,
): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i
  }
  return -1
}
