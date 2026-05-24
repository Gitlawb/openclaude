// Stub — contextCollapse not included in source snapshot (feature-gated)
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
      totalErrors: 0,
      emptySpawnWarningEmitted: false,
      lastError: undefined as string | undefined,
    },
  }
}
