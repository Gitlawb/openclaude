import { describe, expect, it } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'
import * as React from 'react'
import { Text } from '../ink.js'
import { highlightFuzzyMatch } from './highlightMatch.js'
import { renderToString } from './staticRender.js'

/** Collects the string contents of every `<Text bold>` element in the tree. */
function boldSegments(node: React.ReactNode): string[] {
  const out: string[] = []
  const walk = (n: React.ReactNode): void => {
    if (n === null || n === undefined || typeof n === 'string' || typeof n === 'number') {
      return
    }
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (React.isValidElement(n)) {
      const props = n.props as { bold?: boolean; children?: React.ReactNode }
      if (props.bold === true) {
        out.push(React.Children.toArray(props.children).join(''))
        return
      }
      walk(props.children)
    }
  }
  walk(node)
  return out
}

describe('highlightFuzzyMatch', () => {
  it('returns the text unchanged for an empty query', () => {
    expect(highlightFuzzyMatch('src/main.ts', '')).toBe('src/main.ts')
  })

  it('returns the text unchanged when the query is not a subsequence', () => {
    expect(highlightFuzzyMatch('src/main.ts', 'zzz')).toBe('src/main.ts')
  })

  it('preserves the visible text exactly', async () => {
    const out = await renderToString(
      <Text>{highlightFuzzyMatch('src/components/Spinner.tsx', 'spin')}</Text>,
      80,
    )
    expect(stripVTControlCharacters(out).trimEnd()).toBe(
      'src/components/Spinner.tsx',
    )
  })

  it('bolds a contiguous match case-insensitively', () => {
    const node = highlightFuzzyMatch('src/components/Spinner.tsx', 'spin')
    expect(boldSegments(node)).toEqual(['Spin'])
  })

  it('bolds scattered subsequence characters', () => {
    // 'sct' is not contiguous in 'select.tsx' but is a subsequence:
    // greedy-earliest matches s(0), c(4), t(5) → runs 's' and 'ct'
    const node = highlightFuzzyMatch('select.tsx', 'sct')
    expect(boldSegments(node)).toEqual(['s', 'ct'])
  })

  it('coalesces adjacent matched characters into one run', () => {
    // 'mai' in 'main.ts' is contiguous via the subsequence path too;
    // force the subsequence path with a query spanning a gap
    const node = highlightFuzzyMatch('main.ts', 'aints')
    expect(boldSegments(node)).toEqual(['ain', 'ts'])
  })
})
