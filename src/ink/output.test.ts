import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import * as debug from '../utils/debug.ts'
import Output from './output.ts'
import {
  CharPool,
  createScreen,
  HyperlinkPool,
  StylePool,
  type Screen,
} from './screen.ts'

let logSpy: ReturnType<typeof spyOn>

type Harness = {
  output: Output
  stylePool: StylePool
  charPool: CharPool
  hyperlinkPool: HyperlinkPool
}

function createHarness(width: number, height: number): Harness {
  const stylePool = new StylePool()
  const charPool = new CharPool()
  const hyperlinkPool = new HyperlinkPool()
  const screen = createScreen(width, height, stylePool, charPool, hyperlinkPool)

  return {
    output: new Output({ width, height, stylePool, screen }),
    stylePool,
    charPool,
    hyperlinkPool,
  }
}

function resetOutput(harness: Harness, width: number, height: number): void {
  harness.output.reset(
    width,
    height,
    createScreen(
      width,
      height,
      harness.stylePool,
      harness.charPool,
      harness.hyperlinkPool,
    ),
  )
}

function createScreenForHarness(
  harness: Harness,
  width: number,
  height: number,
): Screen {
  return createScreen(
    width,
    height,
    harness.stylePool,
    harness.charPool,
    harness.hyperlinkPool,
  )
}

function writeFullFrame(output: Output, width: number, height: number): void {
  const row = 'x'.repeat(width)

  for (let y = 0; y < height; y++) {
    output.write(0, y, row)
  }
}

beforeEach(() => {
  logSpy = spyOn(debug, 'logForDebugging').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

test('classifies first render high-write frames as expected full redraws', () => {
  const harness = createHarness(80, 20)

  writeFullFrame(harness.output, 80, 20)
  harness.output.get({ highWriteRatioReason: 'first-render' })

  expect(logSpy).toHaveBeenCalledTimes(1)
  expect(logSpy.mock.calls[0]?.[0]).toContain('render.high_write_ratio')
  expect(logSpy.mock.calls[0]?.[0]).toContain('reason=first-render')
  expect(logSpy.mock.calls[0]?.[0]).toContain('expected=true')
  expect(logSpy.mock.calls[0]?.[1]).toEqual({ level: 'debug' })
})

test('classifies resize high-write frames as expected full redraws', () => {
  const harness = createHarness(100, 14)

  writeFullFrame(harness.output, 100, 14)
  harness.output.get({ highWriteRatioReason: 'resize' })

  expect(logSpy).toHaveBeenCalledTimes(1)
  expect(logSpy.mock.calls[0]?.[0]).toContain('reason=resize')
  expect(logSpy.mock.calls[0]?.[0]).toContain('expected=true')
  expect(logSpy.mock.calls[0]?.[1]).toEqual({ level: 'debug' })
})

test('aggregates sustained unknown high-write frames instead of logging every frame', () => {
  const harness = createHarness(80, 20)

  for (let frame = 0; frame < 5; frame++) {
    if (frame > 0) {
      resetOutput(harness, 80, 20)
    }
    writeFullFrame(harness.output, 80, 20)
    harness.output.get()
  }

  expect(logSpy).toHaveBeenCalledTimes(1)
  expect(logSpy.mock.calls[0]?.[0]).toContain('reason=unknown')
  expect(logSpy.mock.calls[0]?.[0]).toContain('frames=3')
  expect(logSpy.mock.calls[0]?.[1]).toEqual({ level: 'warn' })
})

test('suppresses high-write diagnostics and resets unknown aggregation state', () => {
  const harness = createHarness(80, 20)

  for (let frame = 0; frame < 2; frame++) {
    if (frame > 0) {
      resetOutput(harness, 80, 20)
    }
    writeFullFrame(harness.output, 80, 20)
    harness.output.get()
  }

  for (let frame = 0; frame < 5; frame++) {
    resetOutput(harness, 80, 20)
    writeFullFrame(harness.output, 80, 20)
    harness.output.get({ suppressHighWriteRatioDiagnostics: true })
  }

  expect(logSpy).not.toHaveBeenCalled()

  for (let frame = 0; frame < 2; frame++) {
    resetOutput(harness, 80, 20)
    writeFullFrame(harness.output, 80, 20)
    harness.output.get()
  }

  expect(logSpy).not.toHaveBeenCalled()

  resetOutput(harness, 80, 20)
  writeFullFrame(harness.output, 80, 20)
  harness.output.get()

  expect(logSpy).toHaveBeenCalledTimes(1)
  expect(logSpy.mock.calls[0]?.[0]).toContain('reason=unknown')
  expect(logSpy.mock.calls[0]?.[0]).toContain('frames=3')
  expect(logSpy.mock.calls[0]?.[1]).toEqual({ level: 'warn' })
})

test('dimension changes reset sustained unknown high-write aggregation', () => {
  const harness = createHarness(80, 20)

  for (let frame = 0; frame < 2; frame++) {
    if (frame > 0) {
      resetOutput(harness, 80, 20)
    }
    writeFullFrame(harness.output, 80, 20)
    harness.output.get()
  }

  resetOutput(harness, 81, 20)
  writeFullFrame(harness.output, 81, 20)
  harness.output.get()

  expect(logSpy).not.toHaveBeenCalled()

  for (let frame = 0; frame < 2; frame++) {
    resetOutput(harness, 81, 20)
    writeFullFrame(harness.output, 81, 20)
    harness.output.get()
  }

  expect(logSpy).toHaveBeenCalledTimes(1)
  expect(logSpy.mock.calls[0]?.[0]).toContain('frames=3')
})

test('flags suspicious terminal columns only once', () => {
  const harness = createHarness(1201, 1)

  writeFullFrame(harness.output, 1201, 1)
  harness.output.get()

  resetOutput(harness, 1201, 1)
  writeFullFrame(harness.output, 1201, 1)
  harness.output.get()

  expect(logSpy).toHaveBeenCalledTimes(1)
  expect(logSpy.mock.calls[0]?.[0]).toContain(
    'reason=suspicious-terminal-columns',
  )
  expect(logSpy.mock.calls[0]?.[1]).toEqual({ level: 'warn' })
})

test('continues sustained unknown aggregation at suspicious terminal widths', () => {
  const harness = createHarness(1201, 1)

  for (let frame = 0; frame < 3; frame++) {
    if (frame > 0) {
      resetOutput(harness, 1201, 1)
    }
    writeFullFrame(harness.output, 1201, 1)
    harness.output.get()
  }

  expect(logSpy).toHaveBeenCalledTimes(2)
  expect(logSpy.mock.calls[0]?.[0]).toContain(
    'reason=suspicious-terminal-columns',
  )
  expect(logSpy.mock.calls[0]?.[0]).toContain('frames=1')
  expect(logSpy.mock.calls[0]?.[1]).toEqual({ level: 'warn' })
  expect(logSpy.mock.calls[1]?.[0]).toContain('reason=unknown')
  expect(logSpy.mock.calls[1]?.[0]).toContain('frames=3')
  expect(logSpy.mock.calls[1]?.[1]).toEqual({ level: 'warn' })
})

test('suspicious terminal columns can be flagged again after returning to normal width', () => {
  const harness = createHarness(1201, 1)

  writeFullFrame(harness.output, 1201, 1)
  harness.output.get()

  resetOutput(harness, 80, 20)
  writeFullFrame(harness.output, 80, 20)
  harness.output.get({ highWriteRatioReason: 'resize' })

  resetOutput(harness, 1201, 1)
  writeFullFrame(harness.output, 1201, 1)
  harness.output.get()

  expect(logSpy).toHaveBeenCalledTimes(3)
  expect(logSpy.mock.calls[0]?.[0]).toContain(
    'reason=suspicious-terminal-columns',
  )
  expect(logSpy.mock.calls[1]?.[0]).toContain('reason=resize')
  expect(logSpy.mock.calls[2]?.[0]).toContain(
    'reason=suspicious-terminal-columns',
  )
})

test('does not report high-write diagnostics for blit-heavy incremental frames', () => {
  const harness = createHarness(80, 20)
  const prevScreen = createScreenForHarness(harness, 80, 20)

  harness.output.blit(prevScreen, 0, 0, 80, 20)
  harness.output.write(0, 0, 'changed')
  harness.output.get()

  expect(logSpy).not.toHaveBeenCalled()
})
