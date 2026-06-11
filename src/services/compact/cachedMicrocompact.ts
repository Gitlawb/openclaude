// Stub — cachedMicrocompact not included in source snapshot (feature-gated)

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: unknown[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  registeredTools: Set<string>
  pinnedEdits: PinnedCacheEdits[]
  toolOrder: string[]
  deletedRefs: Set<string>
}

export type CachedMCConfig = {
  enabled: boolean
  triggerThreshold: number
  keepRecent: number
  supportedModels?: string[]
  systemPromptSuggestSummaries?: boolean
}

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig(): CachedMCConfig | null {
  return null
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    pinnedEdits: [],
    toolOrder: [],
    deletedRefs: new Set(),
  }
}

export function markToolsSentToAPI(_state: CachedMCState): void {
  // Stub — no-op in external builds
}

export function resetCachedMCState(_state: CachedMCState): void {
  // Stub — no-op in external builds
}

export function registerToolResult(
  _state: CachedMCState,
  _toolUseId: string,
): void {
  // Stub — no-op in external builds
}

export function registerToolMessage(
  _state: CachedMCState,
  _toolUseIds: string[],
): void {
  // Stub — no-op in external builds
}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolUseIds: string[],
): CacheEditsBlock | null {
  return null
}
