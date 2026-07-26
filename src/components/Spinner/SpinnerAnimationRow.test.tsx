import { describe, expect, it } from 'bun:test'
import figures from 'figures'
import { createRef } from 'react'
import { renderToString } from '../../utils/staticRender.js'
import { getCurrentResponseTokenCount, SpinnerAnimationRow } from './SpinnerAnimationRow.js'

function baseProps(overrides: Partial<Parameters<typeof SpinnerAnimationRow>[0]> = {}) {
  const now = Date.now()
  return {
    mode: 'responding' as const,
    reducedMotion: true,
    hasActiveTools: false,
    responseLengthRef: { current: 0 },
    message: 'Thinking',
    messageColor: 'text' as const,
    shimmerColor: 'text' as const,
    loadingStartTimeRef: { current: now },
    totalPausedMsRef: { current: 0 },
    pauseStartTimeRef: createRef<number | null>(),
    verbose: false,
    columns: 120,
    hasRunningTeammates: false,
    teammateTokens: 0,
    foregroundedTeammate: undefined,
    thinkingStatus: null as const,
    effortSuffix: '',
    ...overrides,
  }
}

describe('SpinnerAnimationRow', () => {
  it('uses the current response length without smoothing', () => {
    expect(getCurrentResponseTokenCount(4_000)).toBe(1_000)
  })

  it('shows the current token count immediately when streaming begins', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow {...baseProps({ responseLength: 4_000 })} />,
      120,
    )

    expect(output).toContain('1.0k tokens')
    // Mode glyph stays inside the status parens next to the token count.
    expect(output).toMatch(
      new RegExp(`\\(${figures.arrowDown}[\\s\\S]*1\\.0k tokens[\\s\\S]*\\)`),
    )
  })

  it('shows zero tokens as soon as the first response character arrives', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow {...baseProps({ responseLength: 1 })} />,
      120,
    )

    expect(output).toContain('0 tokens')
  })

  it('does not overflow a narrow row when a spinner suffix is present', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          responseLengthRef: { current: 4_000 },
          spinnerSuffix: 'running stop hooks… 1/1',
          columns: 45,
        })}
      />,
      45,
    )

    expect(output).toContain('running stop hooks… 1/1')
    expect(output).not.toContain('tokens')
  })

  it('shows the requesting mode glyph inside parens before other status parts qualify', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow {...baseProps({ mode: 'requesting' })} />,
      120,
    )

    expect(output).toContain(`(${figures.arrowUp}`)
    expect(output).toContain(')')
    expect(output).not.toContain('tokens')
  })

  it('shows the thinking mode glyph inside parens for thinking-only status', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
        })}
      />,
      120,
    )

    expect(output).toMatch(
      new RegExp(`\\(${figures.arrowDown}[\\s\\S]*thinking[\\s\\S]*\\)`),
    )
    // Nested "(thinking)" is only for teammate bare status; leader uses outer parens.
    expect(output).not.toContain('(thinking)')
  })

  it('keeps thinking text with the mode glyph on moderately narrow terminals', async () => {
    // Primary gate with full parensWidth rejects ~cols 25–27 for message
    // "Thinking"; the leader thinking-only second chance must still fit
    // "(↓ · thinking)" so the thinking word is not dropped.
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          columns: 26,
        })}
      />,
      26,
    )

    expect(output).toContain('thinking')
    expect(output).toMatch(
      new RegExp(`\\(${figures.arrowDown}[\\s\\S]*thinking[\\s\\S]*\\)`),
    )
  })

  it('falls back to bare thinking without glyph when full chrome does not fit', async () => {
    // Cols 21–25: glyph+thinking chrome does not fit, but bare "(thinking)" does.
    // Prefer the thinking word over glyph-only empty status.
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          columns: 23,
        })}
      />,
      23,
    )

    expect(output).toContain('thinking')
    expect(output).toContain('(thinking)')
    expect(output).not.toContain(figures.arrowDown)
    expect(output).not.toContain(figures.arrowUp)
  })

  it('does not enable bare thinking one column short of physical fit', async () => {
    // bareAvailable = columns - messageWidth - 3; for "Thinking" that is
    // columns - 13. At columns=20, bareAvailable=7 < 8, so bare must not show.
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          columns: 20,
        })}
      />,
      20,
    )

    expect(output).not.toContain('(thinking)')
    // Residual 10 >= 5 so a mode glyph alone may still appear; either way the
    // row must not claim a bare thinking status that overflows.
    expect(output).not.toMatch(/Thinking\(thinking\)/)
  })

  it('omits the mode glyph when residual width cannot fit status chrome', async () => {
    // messageWidth("Thinking")+2 = 10; residual at columns=14 is 4 (< 5 after
    // accounting for glimmer trailing space).
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'requesting',
          columns: 14,
        })}
      />,
      14,
    )

    expect(output).not.toContain(figures.arrowUp)
    expect(output).not.toContain(figures.arrowDown)
  })

  it('omits the mode glyph when teammates are running', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'responding',
          responseLength: 4_000,
          hasRunningTeammates: true,
        })}
      />,
      120,
    )

    expect(output).toContain('1.0k tokens')
    expect(output).not.toContain(figures.arrowDown)
    expect(output).not.toContain(figures.arrowUp)
  })

  it('nests (thinking) for teammate bare status under reduced motion', async () => {
    // wantsTimer is true with teammates, so use a narrow width that drops the
    // timer and leaves thinking-only bare status (no mode glyph, no outer parens).
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          hasRunningTeammates: true,
          reducedMotion: true,
          columns: 26,
        })}
      />,
      26,
    )

    expect(output).toContain('(thinking)')
    expect(output).not.toContain(figures.arrowDown)
    expect(output).not.toContain(figures.arrowUp)
    expect(output).not.toMatch(/Thinking thinking/)
  })
})
