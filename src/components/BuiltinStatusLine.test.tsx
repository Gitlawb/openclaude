import { describe, expect, it } from 'bun:test'
import { DEFAULT_GLOBAL_CONFIG } from '../utils/config.js'
import {
  type BuiltinStatusData,
  buildBuiltinStatusSegments,
  builtinStatusLineShouldDisplay,
  fitSegments,
} from './BuiltinStatusLine.js'

const fullData: BuiltinStatusData = {
  modelName: 'Opus 4.8',
  contextUsedPercent: 37.4,
  costUSD: 1.234,
  rateLimit: { label: '5h', usedPercent: 42 },
}

describe('buildBuiltinStatusSegments', () => {
  it('builds all segments when every datum is present', () => {
    const segments = buildBuiltinStatusSegments(fullData)
    expect(segments.map(s => s.key)).toEqual([
      'model',
      'context',
      'cost',
      'rateLimit',
    ])
    expect(segments.map(s => s.text)).toEqual([
      'Opus 4.8',
      'ctx 37%',
      '$1.23',
      '5h 42%',
    ])
  })

  it('omits context before the first assistant turn', () => {
    const segments = buildBuiltinStatusSegments({
      ...fullData,
      contextUsedPercent: null,
    })
    expect(segments.find(s => s.key === 'context')).toBeUndefined()
  })

  it('omits cost at $0 and rate limit without utilization data', () => {
    const segments = buildBuiltinStatusSegments({
      ...fullData,
      costUSD: 0,
      rateLimit: null,
    })
    expect(segments.map(s => s.key)).toEqual(['model', 'context'])
  })

  it('colors context by usage thresholds', () => {
    const at = (pct: number) =>
      buildBuiltinStatusSegments({ ...fullData, contextUsedPercent: pct }).find(
        s => s.key === 'context',
      )?.color
    expect(at(50)).toBeUndefined()
    expect(at(70)).toBe('warning')
    expect(at(90)).toBe('error')
  })

  it('colors context by the displayed rounded percentage', () => {
    const at = (pct: number) =>
      buildBuiltinStatusSegments({ ...fullData, contextUsedPercent: pct }).find(
        s => s.key === 'context',
      )

    expect(at(69.6)).toMatchObject({ text: 'ctx 70%', color: 'warning' })
    expect(at(89.6)).toMatchObject({ text: 'ctx 90%', color: 'error' })
  })

  it('shows sub-one-percent context usage as nonzero', () => {
    const context = buildBuiltinStatusSegments({
      ...fullData,
      contextUsedPercent: 0.01,
    }).find(s => s.key === 'context')

    expect(context?.text).toBe('ctx <1%')
  })

  it('colors rate limit by usage thresholds', () => {
    const at = (pct: number) =>
      buildBuiltinStatusSegments({
        ...fullData,
        rateLimit: { label: '7d', usedPercent: pct },
      }).find(s => s.key === 'rateLimit')?.color
    expect(at(30)).toBeUndefined()
    expect(at(60)).toBe('warning')
    expect(at(85)).toBe('error')
  })
})

describe('fitSegments', () => {
  const segments = buildBuiltinStatusSegments(fullData)
  // 'Opus 4.8 · ctx 37% · $1.23 · 5h 42%' = 35 cols

  it('keeps everything when the line fits', () => {
    expect(fitSegments(segments, 120)).toHaveLength(4)
  })

  it('degrades segments to short forms before dropping any', () => {
    // 'Opus 4.8 · 37% · $1 · 5h 42%' = 28 cols — all four survive at 30
    const fitted = fitSegments(segments, 30)
    expect(fitted.map(s => s.key)).toEqual([
      'model',
      'context',
      'cost',
      'rateLimit',
    ])
    expect(fitted.find(s => s.key === 'context')?.text).toBe('37%')
    expect(fitted.find(s => s.key === 'cost')?.text).toBe('$1')
  })

  it('marks dropped segments with a trailing ellipsis', () => {
    // Too narrow for all four even degraded; hidden data must be visible as hidden
    const fitted = fitSegments(segments, 22)
    expect(fitted.at(-1)?.key).toBe('truncated')
    expect(fitted.at(-1)?.text).toBe('…')
    expect(fitted.map(s => s.key)).toContain('context')
  })

  it('keeps only the model at very narrow widths, skipping the marker if it will not fit', () => {
    const fitted = fitSegments(segments, 10)
    expect(fitted.map(s => s.key)).toEqual(['model'])
  })

  it('does not mutate the caller-visible segment text', () => {
    const before = segments.map(s => s.text)
    fitSegments(segments, 22)
    expect(segments.map(s => s.text)).toEqual(before)
  })

  it('returns empty when even the model does not fit', () => {
    expect(fitSegments(segments, 3)).toEqual([])
  })
})

describe('builtinStatusLineShouldDisplay', () => {
  it('yields to a configured custom statusline', () => {
    expect(
      builtinStatusLineShouldDisplay({
        statusLine: { type: 'command', command: 'echo custom' },
      }),
    ).toBe(false)
  })

  it('displays by default when no custom statusline is configured', () => {
    expect(builtinStatusLineShouldDisplay({})).toBe(true)
  })

  it('hides when defaultStatusLineEnabled is false', () => {
    expect(
      builtinStatusLineShouldDisplay(
        {},
        { ...DEFAULT_GLOBAL_CONFIG, defaultStatusLineEnabled: false },
      ),
    ).toBe(false)
  })

  it('config off still yields to nothing — custom statusline wins regardless', () => {
    expect(
      builtinStatusLineShouldDisplay(
        { statusLine: { type: 'command', command: 'echo custom' } },
        { ...DEFAULT_GLOBAL_CONFIG, defaultStatusLineEnabled: false },
      ),
    ).toBe(false)
  })
})
