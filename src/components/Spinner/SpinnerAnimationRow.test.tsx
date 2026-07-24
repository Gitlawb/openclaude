import { describe, expect, it } from 'bun:test'
import { createRef } from 'react'
import { renderToString } from '../../utils/staticRender.js'
import { getCurrentResponseTokenCount, SpinnerAnimationRow } from './SpinnerAnimationRow.js'

describe('SpinnerAnimationRow', () => {
  it('uses the current response length without smoothing', () => {
    expect(getCurrentResponseTokenCount(4_000)).toBe(1_000)
  })

  it('shows the current token count immediately when streaming begins', async () => {
    const now = Date.now()
    const output = await renderToString(
      <SpinnerAnimationRow
        mode="responding"
        reducedMotion
        hasActiveTools={false}
        responseLengthRef={{ current: 0 }}
        responseLength={4_000}
        message="Thinking"
        messageColor="text"
        shimmerColor="text"
        loadingStartTimeRef={{ current: now }}
        totalPausedMsRef={{ current: 0 }}
        pauseStartTimeRef={createRef<number | null>()}
        verbose={false}
        columns={120}
        hasRunningTeammates={false}
        teammateTokens={0}
        foregroundedTeammate={undefined}
        thinkingStatus={null}
        effortSuffix=""
      />,
      120,
    )

    expect(output).toContain('1.0k tokens')
  })

  it('shows zero tokens as soon as the first response character arrives', async () => {
    const now = Date.now()
    const output = await renderToString(
      <SpinnerAnimationRow
        mode="responding"
        reducedMotion
        hasActiveTools={false}
        responseLengthRef={{ current: 0 }}
        responseLength={1}
        message="Thinking"
        messageColor="text"
        shimmerColor="text"
        loadingStartTimeRef={{ current: now }}
        totalPausedMsRef={{ current: 0 }}
        pauseStartTimeRef={createRef<number | null>()}
        verbose={false}
        columns={120}
        hasRunningTeammates={false}
        teammateTokens={0}
        foregroundedTeammate={undefined}
        thinkingStatus={null}
        effortSuffix=""
      />,
      120,
    )

    expect(output).toContain('0 tokens')
  })

  it('does not overflow a narrow row when a spinner suffix is present', async () => {
    const now = Date.now()
    const output = await renderToString(
      <SpinnerAnimationRow
        mode="responding"
        reducedMotion
        hasActiveTools={false}
        responseLengthRef={{ current: 4_000 }}
        message="Thinking"
        messageColor="text"
        shimmerColor="text"
        loadingStartTimeRef={{ current: now }}
        totalPausedMsRef={{ current: 0 }}
        pauseStartTimeRef={createRef<number | null>()}
        spinnerSuffix="running stop hooks… 1/1"
        verbose={false}
        columns={45}
        hasRunningTeammates={false}
        teammateTokens={0}
        foregroundedTeammate={undefined}
        thinkingStatus={null}
        effortSuffix=""
      />,
      45,
    )

    expect(output).toContain('running stop hooks… 1/1')
    expect(output).not.toContain('tokens')
  })
})
