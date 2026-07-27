import { describe, expect, it } from 'bun:test'
import figures from 'figures'
import { renderToString } from '../../utils/staticRender.js'
import {
  getCurrentResponseTokenCount,
  SpinnerAnimationRow,
  type SpinnerAnimationRowProps,
} from './SpinnerAnimationRow.js'

/** Match Spinner.tsx production message shape: verb + ellipsis. */
const PROD_MESSAGE = 'Thinking…'

function frozenElapsedRefs(elapsedMs: number): Pick<
  SpinnerAnimationRowProps,
  'loadingStartTimeRef' | 'totalPausedMsRef' | 'pauseStartTimeRef'
> {
  const start = 1_000_000
  return {
    loadingStartTimeRef: { current: start },
    totalPausedMsRef: { current: 0 },
    pauseStartTimeRef: { current: start + elapsedMs },
  }
}

function baseProps(
  overrides: Partial<SpinnerAnimationRowProps> = {},
): SpinnerAnimationRowProps {
  return {
    mode: 'responding',
    reducedMotion: true,
    hasActiveTools: false,
    responseLengthRef: { current: 0 },
    message: PROD_MESSAGE,
    messageColor: 'text',
    shimmerColor: 'text',
    ...frozenElapsedRefs(0),
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

/** Non-empty rows from a static Ink render (`renderToString` strips ANSI). */
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
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · 1.0k tokens)`,
    ])
  })

  it('prefers token count over glyph-only status on mid-narrow terminals', async () => {
    // Full glyph+tokens chrome fails primary gate around cols 27–31 for
    // production "Thinking…"; content recovery drops the glyph so tokens show.
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          responseLength: 4_000,
          columns: 29,
        })}
      />,
      29,
    )

    const rows = visibleRows(output)
    expect(rows).toEqual([`● ${PROD_MESSAGE} (1.0k tokens)`])
    expect(rows[0]).not.toContain(figures.arrowDown)
  })

  it('drops the glyph when it would hide tokens behind a visible timer', async () => {
    for (const columns of [31, 32]) {
      const output = await renderToString(
        <SpinnerAnimationRow
          {...baseProps({
            responseLength: 4_000,
            verbose: true,
            ...frozenElapsedRefs(6_000),
            columns,
          })}
        />,
        columns,
      )

      expect(visibleRows(output)).toEqual([
        `● ${PROD_MESSAGE} (6s · 1.0k tokens)`,
      ])
    }
  })

  it('keeps tokens when the elapsed timer becomes eligible on mid-narrow rows', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          responseLength: 4_000,
          columns: 29,
          ...frozenElapsedRefs(6_000),
        })}
      />,
      29,
    )

    expect(visibleRows(output)).toEqual([`● ${PROD_MESSAGE} (1.0k tokens)`])
  })

  it('keeps timer and tokens when timer text widens on mid-narrow rows', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          responseLength: 4_000,
          verbose: true,
          columns: 31,
          ...frozenElapsedRefs(10_000),
        })}
      />,
      31,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (10s · 1.0k tokens)`,
    ])
  })

  it('shows zero tokens as soon as the first response character arrives', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow {...baseProps({ responseLength: 1 })} />,
      120,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · 0 tokens)`,
    ])
  })

  it('does not overflow a narrow row when a spinner suffix is present', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          responseLengthRef: { current: 4_000 },
          spinnerSuffix: 'running stop hooks… 1/1',
          columns: 46,
        })}
      />,
      46,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · running stop hooks… 1/1)`,
    ])
  })

  it('shows the requesting mode glyph inside parens before other status parts qualify', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow {...baseProps({ mode: 'requesting' })} />,
      120,
    )

    // Glyph Box width is 2, so the single-width arrow is padded inside parens.
    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowUp} )`,
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
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · thinking)`,
    ])
  })

  it('keeps thinking text with the mode glyph on moderately narrow terminals', async () => {
    // Primary gate with full parensWidth rejects ~cols 26–28 for production
    // "Thinking…"; the leader thinking-only second chance must still fit
    // "(↓ · thinking)" so the thinking word is not dropped.
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          columns: 27,
        })}
      />,
      27,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · thinking)`,
    ])
  })

  it('falls back to bare thinking without glyph when full chrome does not fit', async () => {
    // Cols 22–26: glyph+thinking chrome does not fit, but bare "(thinking)" does.
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          columns: 24,
        })}
      />,
      24,
    )

    expect(visibleRows(output)).toEqual([`● ${PROD_MESSAGE} (thinking)`])
  })

  it('does not enable bare thinking one column short of physical fit', async () => {
    // bareAvailable = columns - messageWidth - 3; for "Thinking…" that is
    // columns - 14. At columns=21, bareAvailable=7 < 8, so bare must not show.
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          columns: 21,
        })}
      />,
      21,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowDown} )`,
    ])
  })

  it('omits the mode glyph when residual width cannot fit status chrome', async () => {
    // messageWidth("Thinking…")+2 = 11; residual at columns=15 is 4 (< 5).
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'requesting',
          columns: 15,
        })}
      />,
      15,
    )

    expect(visibleRows(output)).toEqual([`● ${PROD_MESSAGE}`])
  })

  it('omits the mode glyph when teammates are running', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'responding',
          responseLength: 4_000,
          hasRunningTeammates: true,
          ...frozenElapsedRefs(0),
        })}
      />,
      120,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (0s · 1.0k tokens)`,
    ])
  })

  it('nests (thinking) for teammate bare status under reduced motion', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          hasRunningTeammates: true,
          reducedMotion: true,
          columns: 27,
        })}
      />,
      27,
    )

    expect(visibleRows(output)).toEqual([`● ${PROD_MESSAGE} (thinking)`])
  })

  it('nests (thinking) for teammate bare status under shimmer', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          hasRunningTeammates: true,
          reducedMotion: false,
          columns: 27,
        })}
      />,
      27,
    )

    // Spinner glyph frame varies under motion; lock nested teammate thinking.
    const rows = visibleRows(output)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatch(/^\S Thinking… \(thinking\)$/)
  })

  it('omits empty glyph chrome when post-thinking duration does not fit', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'responding',
          thinkingStatus: 3_000,
          columns: 25,
        })}
      />,
      25,
    )

    expect(visibleRows(output)).toEqual([`● ${PROD_MESSAGE}`])
  })

  it('omits empty glyph chrome for requesting spins with numeric thinkingStatus', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'requesting',
          thinkingStatus: 3_000,
          columns: 17,
        })}
      />,
      17,
    )

    expect(visibleRows(output)).toEqual([`● ${PROD_MESSAGE}`])
  })

  it('shows post-thinking duration without glyph when bare chrome fits', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'responding',
          thinkingStatus: 3_000,
          columns: 28,
        })}
      />,
      28,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (thought for 3s)`,
    ])
  })

  it('prefers streaming tokens over post-thinking duration on mid-narrow terminals', async () => {
    for (const columns of [30, 31, 35]) {
      const output = await renderToString(
        <SpinnerAnimationRow
          {...baseProps({
            mode: 'responding',
            thinkingStatus: 3_000,
            responseLength: 4_000,
            columns,
          })}
        />,
        columns,
      )

      expect(visibleRows(output)).toEqual([
        `● ${PROD_MESSAGE} (1.0k tokens)`,
      ])
    }
  })

  it('recovers tokens at the exact-fit column boundary', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          responseLength: 4_000,
          columns: 25,
        })}
      />,
      25,
    )

    expect(visibleRows(output)).toEqual([`● ${PROD_MESSAGE} (1.0k tokens)`])
  })

  it('keeps full effort text when it fits with the mode glyph', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          effortSuffix: ' with high effort',
          columns: 44,
        })}
      />,
      44,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · thinking with high effort)`,
    ])
  })

  it('prefers active thinking over timer-only status on mid-narrow rows', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          verbose: true,
          columns: 27,
          ...frozenElapsedRefs(6_000),
        })}
      />,
      27,
    )

    expect(visibleRows(output)).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · thinking)`,
    ])
  })

  it('keeps zero tokens when glyph recovery would swap them for timer only', async () => {
    const tenHoursMs = 10 * 60 * 60 * 1_000
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          responseLength: 1,
          verbose: true,
          ...frozenElapsedRefs(tenHoursMs),
          columns: 29,
        })}
      />,
      29,
    )

    const rows = visibleRows(output)
    expect(rows).toEqual([
      `● ${PROD_MESSAGE} (${figures.arrowDown}  · 0 tokens)`,
    ])
    expect(rows[0]).not.toMatch(/\dh\b/)
  })

  it('keeps leader thinking glyph path under reducedMotion false', async () => {
    const output = await renderToString(
      <SpinnerAnimationRow
        {...baseProps({
          mode: 'thinking',
          thinkingStatus: 'thinking',
          reducedMotion: false,
        })}
      />,
      120,
    )

    // Spinner glyph frame varies under motion; lock the status chrome shape.
    const rows = visibleRows(output)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatch(
      new RegExp(`^\\S Thinking… \\(${figures.arrowDown}  · thinking\\)$`),
    )
  })
})
