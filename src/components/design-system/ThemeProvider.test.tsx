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

import { expect, mock, test } from 'bun:test'
import React, { useEffect } from 'react'
import { createRoot, Text } from '../../ink.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { AppStateProvider } from '../../state/AppState.js'
import { ThemeProvider, useTheme, usePreviewTheme } from './ThemeProvider.js'

mock.module('../../ink/hooks/use-stdin.js', () => ({
  default: () => ({ internal_querier: null }),
}))
mock.module('../../utils/systemTheme.js', () => ({
  getSystemThemeName: () => 'dark',
}))
mock.module('../../utils/config.js', () => ({
  getGlobalConfig: () => ({ theme: 'dark' }),
  saveGlobalConfig: () => {},
}))

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

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

/**
 * Verifies that useTheme() returns the current theme value immediately
 * after setThemeSetting changes it, not a stale cached value.
 *
 * This is the core regression: with React Compiler memo caches, the hook
 * could return [oldTheme, setter] even after the ThemeProvider re-rendered
 * with a new currentTheme, because the memo compared setThemeSetting by
 * reference (stable across renders) and short-circuited.
 */
test('useTheme() reflects updated currentTheme after setThemeSetting call', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  let observedTheme: string | null = null
  let renderCount = 0

  function ThemeWatcher() {
    const [theme] = useTheme()
    observedTheme = theme
    renderCount++
    return <Text>theme:{theme}</Text>
  }

  let setThemeFn: ((s: string) => void) | null = null
  function ThemeSetter() {
    const [, setter] = useTheme()
    setThemeFn = setter
    return null
  }

  root.render(
    <AppStateProvider>
      <KeybindingSetup>
        <ThemeProvider initialState="dark">
          <ThemeWatcher />
          <ThemeSetter />
        </ThemeProvider>
      </KeybindingSetup>
    </AppStateProvider>,
  )

  try {
    // Wait for initial render
    await Bun.sleep(300)
    expect(observedTheme).toBe('dark')

    // Change theme and verify useTheme() returns the new value
    setThemeFn!('light')
    await Bun.sleep(300)
    expect(observedTheme).toBe('light')

    // Change again to verify the hook doesn't get stuck on stale values
    setThemeFn!('ansi')
    await Bun.sleep(300)
    expect(observedTheme).toBe('ansi')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})

/**
 * Verifies that usePreviewTheme() returns fresh action references after
 * the ThemeProvider context value is recreated (e.g. on theme change).
 *
 * With React Compiler memo caches, usePreviewTheme() could return a stale
 * object { setPreviewTheme, savePreview, cancelPreview } that still
 * referenced closures from before the context update.
 */
test('usePreviewTheme() actions remain functional after context update', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  let observedTheme: string | null = null
  let previewActions: ReturnType<typeof usePreviewTheme> | null = null

  function PreviewWatcher() {
    const [theme] = useTheme()
    const actions = usePreviewTheme()
    observedTheme = theme
    previewActions = actions
    return <Text>theme:{theme}</Text>
  }

  let setThemeFn: ((s: string) => void) | null = null
  function ThemeSetter() {
    const [, setter] = useTheme()
    setThemeFn = setter
    return null
  }

  root.render(
    <AppStateProvider>
      <KeybindingSetup>
        <ThemeProvider initialState="dark">
          <PreviewWatcher />
          <ThemeSetter />
        </ThemeProvider>
      </KeybindingSetup>
    </AppStateProvider>,
  )

  try {
    // Wait for initial render
    await Bun.sleep(300)
    expect(observedTheme).toBe('dark')
    const firstActions = previewActions!
    expect(typeof firstActions.setPreviewTheme).toBe('function')

    // Trigger a context re-render by changing theme
    setThemeFn!('light')
    await Bun.sleep(300)
    expect(observedTheme).toBe('light')

    // The new actions should be functional (not stale closures)
    const secondActions = previewActions!
    expect(typeof secondActions.setPreviewTheme).toBe('function')
    expect(typeof secondActions.savePreview).toBe('function')
    expect(typeof secondActions.cancelPreview).toBe('function')

    // setPreviewTheme should actually work
    secondActions.setPreviewTheme('ansi')
    await Bun.sleep(300)
    expect(observedTheme).toBe('ansi')

    // cancelPreview should revert to the saved setting
    secondActions.cancelPreview()
    await Bun.sleep(300)
    expect(observedTheme).toBe('light')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})
