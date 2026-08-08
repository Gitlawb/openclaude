import { describe, expect, it } from 'bun:test'
import { DEFAULT_GLOBAL_CONFIG } from '../../utils/config.js'
import {
  resolveConfiguredFooterStatusLine,
  resolveFooterStatusLine,
  SHORTCUTS_HINT_STARTUP_GRACE,
  shouldSuppressShortcutsHint,
} from './PromptInputFooter.js'

const guardsPass = {
  isPromptMode: true,
  isShort: false,
  hideRegularFooter: false,
  exitMessageShown: false,
  isPasting: false,
}

const customSettings = {
  statusLine: { type: 'command' as const, command: 'echo custom' },
}

describe('resolveFooterStatusLine', () => {
  it('picks the custom statusline when one is configured', () => {
    expect(resolveFooterStatusLine(customSettings, guardsPass)).toBe('custom')
  })

  it('falls back to the builtin statusline when no custom one is configured', () => {
    expect(resolveFooterStatusLine({}, guardsPass)).toBe('builtin')
  })

  it('renders none when the builtin statusline is disabled in config', () => {
    expect(
      resolveFooterStatusLine({}, guardsPass, {
        ...DEFAULT_GLOBAL_CONFIG,
        defaultStatusLineEnabled: false,
      }),
    ).toBeNull()
  })

  it('custom statusline still wins when builtin is disabled', () => {
    expect(
      resolveFooterStatusLine(customSettings, guardsPass, {
        ...DEFAULT_GLOBAL_CONFIG,
        defaultStatusLineEnabled: false,
      }),
    ).toBe('custom')
  })

  // The `? for shortcuts` hint is suppressed iff this resolver returns
  // non-null, so every render guard must force null even when a status
  // line is enabled — otherwise the hint vanishes with nothing in its place.
  for (const [name, guards] of [
    ['non-prompt mode', { ...guardsPass, isPromptMode: false }],
    ['short fullscreen', { ...guardsPass, isShort: true }],
    ['inline suggestions or help', { ...guardsPass, hideRegularFooter: true }],
    ['exit message showing', { ...guardsPass, exitMessageShown: true }],
    ['paste in progress', { ...guardsPass, isPasting: true }],
  ] as const) {
    it(`renders none while ${name}, for both variants`, () => {
      expect(resolveFooterStatusLine({}, guards)).toBeNull()
      expect(resolveFooterStatusLine(customSettings, guards)).toBeNull()
    })
  }
})

describe('resolveConfiguredFooterStatusLine', () => {
  it('keeps a custom statusline configured while transient UI hides its row', () => {
    expect(resolveConfiguredFooterStatusLine(customSettings)).toBe('custom')
    expect(
      resolveFooterStatusLine(customSettings, {
        ...guardsPass,
        exitMessageShown: true,
      }),
    ).toBeNull()
  })
})

describe('shouldSuppressShortcutsHint', () => {
  const base = {
    suppressedByCaller: false,
    footerStatusLine: null,
    isSearching: false,
    numStartups: 100,
  } as const

  it('shows the hint when no status line renders, regardless of tenure', () => {
    expect(shouldSuppressShortcutsHint({ ...base })).toBe(false)
  })

  // Regression: the builtin statusline ships enabled, so suppressing on
  // "a status line renders" alone hid the hint for every user forever.
  it('keeps the hint alongside a status line for new users', () => {
    expect(
      shouldSuppressShortcutsHint({
        ...base,
        footerStatusLine: 'builtin',
        numStartups: SHORTCUTS_HINT_STARTUP_GRACE,
      }),
    ).toBe(false)
  })

  it('yields to the status line for established users', () => {
    expect(
      shouldSuppressShortcutsHint({
        ...base,
        footerStatusLine: 'builtin',
        numStartups: SHORTCUTS_HINT_STARTUP_GRACE + 1,
      }),
    ).toBe(true)
  })

  it('always yields to a custom status line — explicit config wins over the grace period', () => {
    expect(
      shouldSuppressShortcutsHint({
        ...base,
        footerStatusLine: 'custom',
        numStartups: 1,
      }),
    ).toBe(true)
  })

  it('always suppresses during ctrl-r search and caller overrides', () => {
    expect(shouldSuppressShortcutsHint({ ...base, isSearching: true })).toBe(
      true,
    )
    expect(
      shouldSuppressShortcutsHint({ ...base, suppressedByCaller: true }),
    ).toBe(true)
  })
})
