export function isSnipBoundaryMessage(message: unknown): boolean {
  return Boolean((message as any)?.snipMetadata)
}

/**
 * Filter a message array to exclude messages removed by prior snip operations.
 * Reads all snipMetadata.removedUuids across all snip boundaries in the array.
 * Used by getMessagesAfterCompactBoundary when HISTORY_SNIP is enabled.
 */
export function projectSnippedView<T>(messages: T[]): T[] {
  const removedUuids = new Set<string>()
  for (const msg of messages) {
    const uuids = (msg as any)?.snipMetadata?.removedUuids
    if (!Array.isArray(uuids)) continue
    for (const uuid of uuids) removedUuids.add(uuid as string)
  }
  if (removedUuids.size === 0) return messages
  return messages.filter(msg => {
    const uuid = (msg as any)?.uuid
    return !uuid || !removedUuids.has(uuid as string)
  })
}
