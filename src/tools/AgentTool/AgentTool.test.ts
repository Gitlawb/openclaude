import { describe, expect, test } from 'bun:test'

import { resolveEffectiveRunInBackground } from './AgentTool.js'

describe('resolveEffectiveRunInBackground', () => {
  test('keeps run_in_background when schema can advertise it', () => {
    expect(
      resolveEffectiveRunInBackground(true, {
        backgroundTasksDisabled: false,
        forkSubagentEnabled: false,
      }),
    ).toBe(true)

    expect(
      resolveEffectiveRunInBackground(false, {
        backgroundTasksDisabled: false,
        forkSubagentEnabled: false,
      }),
    ).toBe(false)
  })

  test('ignores run_in_background when background tasks are disabled', () => {
    expect(
      resolveEffectiveRunInBackground(true, {
        backgroundTasksDisabled: true,
        forkSubagentEnabled: false,
      }),
    ).toBeUndefined()
  })

  test('ignores run_in_background when fork subagent mode is enabled', () => {
    expect(
      resolveEffectiveRunInBackground(true, {
        backgroundTasksDisabled: false,
        forkSubagentEnabled: true,
      }),
    ).toBeUndefined()
  })
})
