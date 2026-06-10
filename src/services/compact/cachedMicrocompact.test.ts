import { describe, expect, test } from 'bun:test'

import {
  createCachedMCState,
  createCacheEditsBlock,
  getCachedMCConfig,
  getToolResultsToDelete,
  isCachedMicrocompactEnabled,
  isModelSupportedForCacheEditing,
  markToolsSentToAPI,
  registerToolMessage,
  registerToolResult,
  resetCachedMCState,
} from './cachedMicrocompact.js'

describe('cachedMicrocompact stub', () => {
  test('feature is disabled', () => {
    expect(isCachedMicrocompactEnabled()).toBe(false)
  })

  test('no models are supported for cache editing', () => {
    expect(isModelSupportedForCacheEditing('claude-3-5-sonnet')).toBe(false)
    expect(isModelSupportedForCacheEditing('gpt-4')).toBe(false)
  })

  test('config returns null when feature is disabled', () => {
    expect(getCachedMCConfig()).toBeNull()
  })

  test('createCachedMCState returns valid empty state', () => {
    const state = createCachedMCState()
    expect(state).toBeDefined()
    expect(state.registeredTools).toBeInstanceOf(Set)
    expect(state.registeredTools.size).toBe(0)
    expect(state.pinnedEdits).toEqual([])
    expect(state.toolOrder).toEqual([])
    expect(state.deletedRefs).toBeInstanceOf(Set)
    expect(state.deletedRefs.size).toBe(0)
  })

  test('stub functions are no-ops', () => {
    const state = createCachedMCState()

    // These should not throw
    markToolsSentToAPI(state)
    resetCachedMCState(state)
    registerToolResult(state, 'tool-use-123')
    registerToolMessage(state, ['tool-use-123', 'tool-use-456'])

    // State should remain unchanged
    expect(state.registeredTools.size).toBe(0)
    expect(state.pinnedEdits).toEqual([])
  })

  test('getToolResultsToDelete returns empty array', () => {
    const state = createCachedMCState()
    registerToolResult(state, 'tool-use-123')
    expect(getToolResultsToDelete(state)).toEqual([])
  })

  test('createCacheEditsBlock returns null when feature is disabled', () => {
    const state = createCachedMCState()
    expect(createCacheEditsBlock(state, ['tool-use-123'])).toBeNull()
  })
})
