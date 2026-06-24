import { describe, expect, test } from 'bun:test'
import type { QuerySource } from '../constants/querySource.js'
import { isMainThreadCacheParamSource } from './stopHooks.js'

describe('isMainThreadCacheParamSource', () => {
  test('matches the bare main-thread and sdk sources', () => {
    expect(isMainThreadCacheParamSource('repl_main_thread' as QuerySource)).toBe(true)
    expect(isMainThreadCacheParamSource('sdk' as QuerySource)).toBe(true)
  })

  test('matches output-style main-thread sources', () => {
    expect(
      isMainThreadCacheParamSource('repl_main_thread:outputStyle:explanatory' as QuerySource),
    ).toBe(true)
    expect(
      isMainThreadCacheParamSource('repl_main_thread:outputStyle:custom' as QuerySource),
    ).toBe(true)
  })

  test('does not match subagent sources', () => {
    expect(isMainThreadCacheParamSource('marble_origami' as QuerySource)).toBe(false)
    expect(isMainThreadCacheParamSource('user_prompt' as QuerySource)).toBe(false)
  })
})
