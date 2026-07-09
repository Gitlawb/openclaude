import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  AUTONOMY_DEFAULT_MAX_TOOL_RESULT_CHARS,
  AUTONOMY_DEFAULT_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  getAutonomyPerMessageBudgetLimit,
  getAutonomyPersistenceThreshold,
  shouldEnableAutonomyToolResultMasking,
} from './contextBudget.js'

describe('contextBudget', () => {
  const savedMask = process.env.OPENCLAUDE_MASK_TOOL_RESULTS
  const savedAutonomy = process.env.OPENCLAUDE_AUTONOMY
  const savedMax = process.env.OPENCLAUDE_MAX_TOOL_RESULT_CHARS
  const savedMsg = process.env.OPENCLAUDE_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS

  beforeEach(() => {
    delete process.env.OPENCLAUDE_MASK_TOOL_RESULTS
    delete process.env.OPENCLAUDE_AUTONOMY
    delete process.env.OPENCLAUDE_MAX_TOOL_RESULT_CHARS
    delete process.env.OPENCLAUDE_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS
  })

  afterEach(() => {
    restore('OPENCLAUDE_MASK_TOOL_RESULTS', savedMask)
    restore('OPENCLAUDE_AUTONOMY', savedAutonomy)
    restore('OPENCLAUDE_MAX_TOOL_RESULT_CHARS', savedMax)
    restore('OPENCLAUDE_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS', savedMsg)
  })

  function restore(key: string, val: string | undefined) {
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }

  test('masking off by default without autonomy', () => {
    expect(shouldEnableAutonomyToolResultMasking()).toBe(false)
    expect(getAutonomyPersistenceThreshold(100_000)).toBeUndefined()
    expect(getAutonomyPerMessageBudgetLimit()).toBeUndefined()
  })

  test('OPENCLAUDE_MASK_TOOL_RESULTS enables tighter caps', () => {
    process.env.OPENCLAUDE_MASK_TOOL_RESULTS = '1'
    expect(shouldEnableAutonomyToolResultMasking()).toBe(true)
    expect(getAutonomyPersistenceThreshold(100_000)).toBe(
      AUTONOMY_DEFAULT_MAX_TOOL_RESULT_CHARS,
    )
    expect(getAutonomyPerMessageBudgetLimit()).toBe(
      AUTONOMY_DEFAULT_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
    )
  })

  test('OPENCLAUDE_AUTONOMY enables masking by default', () => {
    process.env.OPENCLAUDE_AUTONOMY = '1'
    expect(shouldEnableAutonomyToolResultMasking()).toBe(true)
  })

  test('OPENCLAUDE_MASK_TOOL_RESULTS=0 disables even with autonomy', () => {
    process.env.OPENCLAUDE_AUTONOMY = '1'
    process.env.OPENCLAUDE_MASK_TOOL_RESULTS = '0'
    expect(shouldEnableAutonomyToolResultMasking()).toBe(false)
  })

  test('custom env caps are respected', () => {
    process.env.OPENCLAUDE_MASK_TOOL_RESULTS = '1'
    process.env.OPENCLAUDE_MAX_TOOL_RESULT_CHARS = '5000'
    process.env.OPENCLAUDE_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = '30000'
    expect(getAutonomyPersistenceThreshold(100_000)).toBe(5000)
    expect(getAutonomyPerMessageBudgetLimit()).toBe(30000)
  })

  test('Infinity declared size stays Infinity (Read opt-out)', () => {
    process.env.OPENCLAUDE_MASK_TOOL_RESULTS = '1'
    expect(getAutonomyPersistenceThreshold(Infinity)).toBe(Infinity)
  })

  test('threshold never exceeds declared tool max', () => {
    process.env.OPENCLAUDE_MASK_TOOL_RESULTS = '1'
    expect(getAutonomyPersistenceThreshold(8_000)).toBe(8_000)
  })
})
