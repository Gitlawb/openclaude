import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getDisplayedEffortLevel, getEffortSuffix } from './effort.js'

// ultracode is a meta-mode (the standing multi-agent permission). The display
// surfaces show it as the current level when it is the EFFECTIVE effort —
// CLAUDE_CODE_EFFORT_LEVEL takes precedence over the session value (matching the
// API and the permission gate), so the display follows that precedence too.
// @see #1551
const MODEL = 'claude-opus-4-8'
let savedEnv: string | undefined

beforeEach(() => {
  savedEnv = process.env.CLAUDE_CODE_EFFORT_LEVEL
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL
})

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
  } else {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = savedEnv
  }
})

describe('ultracode display surfaces', () => {
  test('getDisplayedEffortLevel surfaces ultracode (not its xhigh mapping)', () => {
    expect(getDisplayedEffortLevel(MODEL, 'ultracode')).toBe('ultracode')
  })

  test('getEffortSuffix surfaces ultracode while it is active', () => {
    expect(getEffortSuffix(MODEL, 'ultracode')).toBe(' with ultracode effort')
  })

  test('a conflicting CLAUDE_CODE_EFFORT_LEVEL override wins over session ultracode', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high'
    expect(getDisplayedEffortLevel(MODEL, 'ultracode')).toBe('high')
    expect(getEffortSuffix(MODEL, 'ultracode')).toBe(' with high effort')
  })

  test('CLAUDE_CODE_EFFORT_LEVEL=ultracode surfaces ultracode even if the session differs', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'ultracode'
    expect(getDisplayedEffortLevel(MODEL, 'high')).toBe('ultracode')
    expect(getEffortSuffix(MODEL, 'high')).toBe(' with ultracode effort')
  })
})
