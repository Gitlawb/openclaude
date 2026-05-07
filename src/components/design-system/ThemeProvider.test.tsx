/**
 * @file Regression tests for ThemeProvider context hooks.
 *
 * These tests verify that useTheme() and usePreviewTheme() always return
 * fresh values when the ThemeProvider context updates, even when the
 * React Compiler memo cache (_c) is in play.
 *
 * Bug: The React Compiler emits memo caches that compare individual
 * destructured context properties by referential equality. When
 * ThemeProvider's useMemo recreates the context value object (because
 * currentTheme changed), but some properties like setThemeSetting are
 * referentially stable across renders, the _c memo cache sees no change
 * and returns the stale cached result — a tuple/object still holding
 * the old currentTheme value.
 *
 * Fix: Remove the _c memo wrappers so useTheme()/usePreviewTheme()
 * always read the current context value directly.
 */
import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React, { useEffect } from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot, Text, useTheme } from '../../ink.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { AppStateProvider } from '../../state/AppState.js'
import { ThemeProvider, usePreviewTheme } from './ThemeProvider.js'

mock.module('../StructuredDiff.js', () => ({
  StructuredDiff: function StructuredDiffPreview(): React.ReactNode {
    return <Text>diff</Text>
  },
}))
mock.module('../StructuredDiff/colorDiff.js', () => ({
  getColorModuleUnavailableReason: () => 'env',
  getSyntaxTheme: () => null,
}))

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0
  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break
    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) lastFrame = frame
    cursor = end + SYNC_END.length
  }
  return lastFrame ?? output
}

function createTestStreams() {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: () => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => { output += chunk.toString() })
  return { stdout, stdin, getOutput: () => output }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('Timed out waiting for condition')
}

async function waitForFrame(
  getOutput: () => string,
  predicate: (frame: string) => boolean,
): Promise<string> {
  let frame = ''
  await waitForCondition(() => {
    frame = stripAnsi(extractLastFrame(getOutput()))
    return predicate(frame)
  })
  return frame
}

afterEach(() => {
  mock.restore()
})

/**
 * Verifies that useTheme() returns the current theme value immediately
 * after setThemeSetting changes it, not a stale cached value.
 *
 * With React Compiler memo caches, the hook could return [oldTheme, setter]
 * because the memo compared setThemeSetting by reference (stable across
 * renders) and short-circuited, missing the currentTheme change.
 */
test('useTheme() reflects updated currentTheme after setThemeSetting call', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  function ThemeDisplay() {
    const [theme] = useTheme()
    return <Text>current:{theme}</Text>
  }

  let setThemeFn: ((s: string) => void) | null = null
  function ThemeSetter() {
    const [, setter] = useTheme()
    useEffect(() => { setThemeFn = setter })
    return null
  }

  root.render(
    <AppStateProvider>
      <KeybindingSetup>
        <ThemeProvider initialState="dark">
          <ThemeDisplay />
          <ThemeSetter />
        </ThemeProvider>
      </KeybindingSetup>
    </AppStateProvider>,
  )

  try {
    // Initial render
    const initial = await waitForFrame(getOutput, f => f.includes('current:dark'))
    expect(initial).toContain('current:dark')

    // Change theme — useTheme() must reflect the new value
    setThemeFn!('light')
    const afterLight = await waitForFrame(getOutput, f => f.includes('current:light'))
    expect(afterLight).toContain('current:light')

    // Change again to confirm no stale caching
    setThemeFn!('ansi')
    const afterAnsi = await waitForFrame(getOutput, f => f.includes('current:ansi'))
    expect(afterAnsi).toContain('current:ansi')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})

/**
 * Verifies that usePreviewTheme() returns functional action references
 * after the ThemeProvider context value is recreated on theme change.
 */
test('usePreviewTheme() setPreviewTheme changes displayed theme', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  let previewActions: ReturnType<typeof usePreviewTheme> | null = null

  function ThemeDisplay() {
    const [theme] = useTheme()
    const actions = usePreviewTheme()
    useEffect(() => { previewActions = actions })
    return <Text>current:{theme}</Text>
  }

  root.render(
    <AppStateProvider>
      <KeybindingSetup>
        <ThemeProvider initialState="dark">
          <ThemeDisplay />
        </ThemeProvider>
      </KeybindingSetup>
    </AppStateProvider>,
  )

  try {
    // Initial render
    await waitForFrame(getOutput, f => f.includes('current:dark'))

    // setPreviewTheme should change the displayed theme
    previewActions!.setPreviewTheme('light')
    const afterPreview = await waitForFrame(getOutput, f => f.includes('current:light'))
    expect(afterPreview).toContain('current:light')

    // cancelPreview should revert to the saved setting
    previewActions!.cancelPreview()
    const afterCancel = await waitForFrame(getOutput, f => f.includes('current:dark'))
    expect(afterCancel).toContain('current:dark')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})