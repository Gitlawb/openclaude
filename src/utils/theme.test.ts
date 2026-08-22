import { expect, test } from 'bun:test'

import { getTheme, THEME_NAMES, type ThemeName } from './theme.js'

test('Nord theme names are registered', () => {
  for (const name of ['dark-nord', 'light-nord', 'dark-nord-ansi'] as const) {
    expect(THEME_NAMES).toContain<ThemeName>(name)
  }
})

test('getTheme resolves dark-nord to a dark palette', () => {
  const theme = getTheme('dark-nord')
  expect(theme.text).toBe('rgb(236,239,244)') // nord6 — light text on dark bg
  expect(theme.background).toBe('rgb(143,188,187)') // nord7 — bright cyan
})

test('getTheme resolves light-nord to a light palette with darkened accents', () => {
  const theme = getTheme('light-nord')
  expect(theme.text).toBe('rgb(46,52,64)') // nord0 — dark text on light bg
  // `background` doubles as a foreground accent, so it must be dark enough
  // for contrast on a white background (matches the darkened nord7 tone).
  expect(theme.background).toBe('rgb(58,140,140)')
})

test('getTheme resolves dark-nord-ansi to ANSI tokens', () => {
  const theme = getTheme('dark-nord-ansi')
  expect(theme.text).toBe('ansi:whiteBright')
})
