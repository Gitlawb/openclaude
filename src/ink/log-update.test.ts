import { expect, test } from 'bun:test'

import type { Frame } from './frame.ts'
import { LogUpdate } from './log-update.ts'
import {
  CellWidth,
  CharPool,
  createScreen,
  HyperlinkPool,
  setCellAt,
  StylePool,
} from './screen.ts'

function collectStdout(diff: ReturnType<LogUpdate['render']>): string {
  return diff
    .filter((patch): patch is Extract<(typeof diff)[number], { type: 'stdout' }> => patch.type === 'stdout')
    .map(patch => patch.content)
    .join('')
}

function createHarness() {
  const stylePool = new StylePool()
  const charPool = new CharPool()
  const hyperlinkPool = new HyperlinkPool()

  return {
    stylePool,
    charPool,
    hyperlinkPool,
    log: new LogUpdate({ isTTY: true, stylePool }),
  }
}

function frameFromLines(
  stylePool: StylePool,
  charPool: CharPool,
  hyperlinkPool: HyperlinkPool,
  lines: string[],
  cursor = { x: 0, y: lines.length, visible: true },
): Frame {
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const screen = createScreen(width, lines.length, stylePool, charPool, hyperlinkPool)

  for (const [y, line] of lines.entries()) {
    for (const [x, char] of [...line].entries()) {
      setCellAt(screen, x, y, {
        char,
        styleId: stylePool.none,
        width: CellWidth.Narrow,
      })
    }
  }

  return {
    screen,
    viewport: {
      width: Math.max(width, 1),
      height: 10,
    },
    cursor,
  }
}

test('ghostty main-screen rewrite paints initial content without full terminal reset', () => {
  const { stylePool, charPool, hyperlinkPool, log } = createHarness()
  const prev = frameFromLines(stylePool, charPool, hyperlinkPool, [])
  const next = frameFromLines(stylePool, charPool, hyperlinkPool, ['prompt'])

  const diff = log.render(prev, next, false, true, true)
  const stdout = collectStdout(diff)

  expect(diff.some(patch => patch.type === 'clearTerminal')).toBe(false)
  expect(diff.some(patch => patch.type === 'clear')).toBe(false)
  expect(stdout).toContain('prompt')
})

test('ghostty main-screen rewrite clears the previous prompt block before repainting', () => {
  const { stylePool, charPool, hyperlinkPool, log } = createHarness()
  const prev = frameFromLines(
    stylePool,
    charPool,
    hyperlinkPool,
    ['status', '> abc'],
  )
  const next = frameFromLines(
    stylePool,
    charPool,
    hyperlinkPool,
    ['status', '> abcd'],
  )

  const diff = log.render(prev, next, false, true, true)
  const stdout = collectStdout(diff)

  expect(diff.some(patch => patch.type === 'clearTerminal')).toBe(false)
  expect(diff.some(patch => patch.type === 'clear' && patch.count === 2)).toBe(
    true,
  )
  expect(stdout).toContain('status')
  expect(stdout).toContain('abcd')
})
