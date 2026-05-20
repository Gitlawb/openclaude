export function isContextCollapseEnabled(): boolean {
  return false
}

export function getContextCollapseState() {
  return null
}

export function getStats() {
  return {
    collapsedSpans: 0,
    collapsedMessages: 0,
    stagedSpans: 0,
    health: {
      totalSpawns: 0,
      totalEmptySpawns: 0,
      totalErrors: 0,
      lastError: null as string | null,
      emptySpawnWarningEmitted: false,
    },
  }
}
