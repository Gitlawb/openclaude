import type { Message } from '../../types/message.js'

let idCounter = 0

export function resetCollapseIdCounter(seed?: number): void {
  idCounter = seed ?? 0
}

export function deriveCollapseId(_uuid: string): string {
  idCounter++
  return String(idCounter).padStart(16, '0')
}

export function getSpanUuids(
  messages: Message[],
  firstUuid: string,
  lastUuid: string,
): string[] {
  const firstIdx = messages.findIndex(m => m.uuid === firstUuid)
  const lastIdx = findLastIndex(messages, m => m.uuid === lastUuid)

  if (firstIdx === -1 || lastIdx === -1 || firstIdx > lastIdx) {
    return []
  }

  return messages.slice(firstIdx, lastIdx + 1).map(m => m.uuid as string)
}

export function buildCollapsePlaceholder(
  collapseId: string,
  summary: string,
): string {
  return `<collapsed id="${collapseId}">${summary}</collapsed>`
}

export function isCollapsePlaceholder(message: Message): boolean {
  if (message.type !== 'system') return false
  const content = 'content' in message ? (message as Record<string, unknown>).content : ''
  return typeof content === 'string' && content.startsWith('<collapsed')
}

export function isWithinCollapsedSpan(
  message: Message,
  messages: Message[],
  commits: { firstArchivedUuid: string; lastArchivedUuid: string }[],
): boolean {
  const msgUuid = message.uuid as string | undefined
  if (!msgUuid) return false

  const msgIdx = messages.findIndex(m => m.uuid === msgUuid)
  if (msgIdx === -1) return false

  return commits.some(c => {
    const firstIdx = messages.findIndex(m => m.uuid === c.firstArchivedUuid)
    const lastIdx = findLastIndex(messages, m => m.uuid === c.lastArchivedUuid)
    return firstIdx !== -1 && lastIdx !== -1 && firstIdx <= msgIdx && msgIdx <= lastIdx
  })
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

export { findLastIndex }
