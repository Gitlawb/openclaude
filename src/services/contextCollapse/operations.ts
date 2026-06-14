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

    const placeholder: Message = {
      type: 'system',
      subtype: 'informational',
      content: c.summaryContent,
      uuid: c.summaryUuid,
      timestamp: new Date().toISOString(),
      isMeta: true,
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
