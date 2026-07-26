import { describe, expect, it } from 'bun:test'
import figures from 'figures'
import { createRef } from 'react'
import { renderToString } from '../../utils/staticRender.js'
import {
  getCurrentResponseTokenCount,
  SpinnerAnimationRow,
  type SpinnerAnimationRowProps,
} from './SpinnerAnimationRow.js'

function baseProps(
  overrides: Partial<SpinnerAnimationRowProps> = {},
): SpinnerAnimationRowProps {
  const now = Date.now()
  return {
    mode: 'responding',
    reducedMotion: true,
    hasActiveTools: false,
    responseLengthRef: { current: 0 },
    message: 'Thinking',
    messageColor: 'text',
    shimmerColor: 'text',
    loadingStartTimeRef: { current: now },
    totalPausedMsRef: { current: 0 },
    pauseStartTimeRef: createRef<number | null>(),
    verbose: false,
    columns: 120,
    hasRunningTeammates: false,
    teammateTokens: 0,
    foregroundedTeammate: undefined,
    thinkingStatus: null,
    effortSuffix: '',
    ...overrides,
  }
}

/** ANSI-stripped non-empty rows from a static Ink render. */
function visibleRows(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map(line => line.replace(/\s+$/u, ''))
    .filter(line => line.trim().length > 0)
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

    expect(visibleRows(output)).toEqual([
      `● Thinking (${figures.arrowDown}  · 1.0k tokens)`,
    ])
  })

  it('shows zero tokens as soon as the first response character arrives', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow {...baseProps({ responseLength: 1 })} />,
      120,
    )

    expect(visibleRows(output)).toEqual([
      `● Thinking (${figures.arrowDown}  · 0 tokens)`,
    ])
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

    expect(visibleRows(output)).toEqual([
      `● Thinking (${figures.arrowDown}  · running stop hooks… 1/1)`,
    ])
  })

  it('shows the requesting mode glyph inside parens before other status parts qualify', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow {...baseProps({ mode: 'requesting' })} />,
      120,
    )

    // Glyph Box width is 2, so the single-width arrow is padded inside parens.
    expect(visibleRows(output)).toEqual([
      `● Thinking (${figures.arrowUp} )`,
    ])
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

    expect(visibleRows(output)).toEqual([
      `● Thinking (${figures.arrowDown}  · thinking)`,
    ])
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

    expect(visibleRows(output)).toEqual([
      `● Thinking (${figures.arrowDown}  · thinking)`,
    ])
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

    expect(visibleRows(output)).toEqual(['● Thinking (thinking)'])
  })

  it('does not enable bare thinking one column short of physical fit', async () => {
    // bareAvailable = columns - messageWidth - 3; for "Thinking" that is
    // columns - 13. At columns=20, bareAvailable=7 < 8, so bare must not show.
    // Residual still allows glyph-only status chrome.
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

    expect(visibleRows(output)).toEqual([
      `● Thinking (${figures.arrowDown} )`,
    ])
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

    expect(visibleRows(output)).toEqual(['● Thinking'])
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

    // wantsTimer is true for teammates, so the elapsed timer appears with tokens.
    // Timer text depends on wall clock (0s vs 0.0s), so match the full row shape.
    const rows = visibleRows(output)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatch(/^● Thinking \(\d+(?:\.\d+)?s · 1\.0k tokens\)$/)
    expect(rows[0]).not.toContain(figures.arrowDown)
    expect(rows[0]).not.toContain(figures.arrowUp)
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

    expect(visibleRows(output)).toEqual(['● Thinking (thinking)'])
  })
})
