import { expect, test } from 'bun:test'

import { emptyFrame, type Frame } from './frame.ts'
import { classifyHighWriteRatioReason } from './renderer.ts'
import {
  CharPool,
  createScreen,
  HyperlinkPool,
  StylePool,
} from './screen.ts'

const stylePool = new StylePool()
const charPool = new CharPool()
const hyperlinkPool = new HyperlinkPool()

function createFrame({
  screenWidth,
  screenHeight,
  viewportWidth = screenWidth,
  viewportHeight = screenHeight,
}: {
  screenWidth: number
  screenHeight: number
  viewportWidth?: number
  viewportHeight?: number
}): Frame {
  return {
    screen: createScreen(
      screenWidth,
      screenHeight,
      stylePool,
      charPool,
      hyperlinkPool,
    ),
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
    },
    cursor: { x: 0, y: 0, visible: true },
  }
}

test('high-write classifier identifies initial empty frame as first render', () => {
  const frontFrame = emptyFrame(24, 80, stylePool, charPool, hyperlinkPool)

  expect(
    classifyHighWriteRatioReason(
      {
        frontFrame,
        backFrame: frontFrame,
        isTTY: true,
        terminalWidth: 80,
        terminalRows: 24,
        altScreen: false,
        prevFrameContaminated: false,
      },
      false,
    ),
  ).toBe('first-render')
})

test('high-write classifier reports debug full redraw when a contaminated empty frame forces repaint', () => {
  const frontFrame = emptyFrame(24, 80, stylePool, charPool, hyperlinkPool)

  expect(
    classifyHighWriteRatioReason(
      {
        frontFrame,
        backFrame: frontFrame,
        isTTY: true,
        terminalWidth: 80,
        terminalRows: 24,
        altScreen: false,
        prevFrameContaminated: true,
      },
      false,
    ),
  ).toBe('debug-full-redraw')
})

test('high-write classifier does not treat steady alt-screen viewport offset as resize', () => {
  const frontFrame = createFrame({
    screenWidth: 120,
    screenHeight: 24,
    viewportWidth: 120,
    viewportHeight: 25,
  })

  expect(
    classifyHighWriteRatioReason(
      {
        frontFrame,
        backFrame: frontFrame,
        isTTY: true,
        terminalWidth: 120,
        terminalRows: 24,
        altScreen: true,
        prevFrameContaminated: true,
      },
      false,
    ),
  ).toBe('remount')
})

test('high-write classifier keeps real resize reason ahead of contamination', () => {
  const frontFrame = createFrame({
    screenWidth: 120,
    screenHeight: 24,
    viewportWidth: 120,
    viewportHeight: 24,
  })

  expect(
    classifyHighWriteRatioReason(
      {
        frontFrame,
        backFrame: frontFrame,
        isTTY: true,
        terminalWidth: 120,
        terminalRows: 24,
        altScreen: true,
        prevFrameContaminated: true,
      },
      false,
    ),
  ).toBe('resize')
})

test('high-write classifier reports absolute removals as remount redraws', () => {
  const frontFrame = createFrame({
    screenWidth: 80,
    screenHeight: 24,
    viewportWidth: 80,
    viewportHeight: 24,
  })

  expect(
    classifyHighWriteRatioReason(
      {
        frontFrame,
        backFrame: frontFrame,
        isTTY: true,
        terminalWidth: 80,
        terminalRows: 24,
        altScreen: false,
        prevFrameContaminated: false,
      },
      true,
    ),
  ).toBe('remount')
})
