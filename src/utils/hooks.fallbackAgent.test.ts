import { describe, expect, test } from 'bun:test'
import { isFallbackAgentLaunchSuccessStatus } from './hooks.js'

describe('fallback agent hook launch statuses', () => {
  test('accepts only current AgentTool success statuses', () => {
    expect(isFallbackAgentLaunchSuccessStatus('async_launched')).toBe(true)
    expect(isFallbackAgentLaunchSuccessStatus('completed')).toBe(true)
    expect(isFallbackAgentLaunchSuccessStatus('teammate_spawned')).toBe(true)

    expect(isFallbackAgentLaunchSuccessStatus('remote_launched')).toBe(false)
    expect(isFallbackAgentLaunchSuccessStatus(undefined)).toBe(false)
  })
})
