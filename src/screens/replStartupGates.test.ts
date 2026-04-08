import { describe, expect, test } from 'bun:test'
import { shouldStartStartupChecks } from './replStartupGates.js'

describe('shouldStartStartupChecks', () => {
  test('returns false for remote sessions', () => {
    expect(
      shouldStartStartupChecks({
        isRemoteSession: true,
        promptTypingSuppressionActive: false,
        startupChecksStarted: false,
      }),
    ).toBe(false)
  })

  test('returns false while prompt typing suppression is active', () => {
    expect(
      shouldStartStartupChecks({
        isRemoteSession: false,
        promptTypingSuppressionActive: true,
        startupChecksStarted: false,
      }),
    ).toBe(false)
  })

  test('returns true once local startup is idle and checks have not started', () => {
    expect(
      shouldStartStartupChecks({
        isRemoteSession: false,
        promptTypingSuppressionActive: false,
        startupChecksStarted: false,
      }),
    ).toBe(true)
  })

  test('returns false after startup checks have already started', () => {
    expect(
      shouldStartStartupChecks({
        isRemoteSession: false,
        promptTypingSuppressionActive: false,
        startupChecksStarted: true,
      }),
    ).toBe(false)
  })
})
