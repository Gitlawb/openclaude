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

  it('drops highest-priority-number segments first when narrow', () => {
    const fitted = fitSegments(segments, 30)
    expect(fitted.map(s => s.key)).toEqual(['model', 'context', 'cost'])
  })

  it('keeps only the model at very narrow widths', () => {
    const fitted = fitSegments(segments, 10)
    expect(fitted.map(s => s.key)).toEqual(['model'])
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
