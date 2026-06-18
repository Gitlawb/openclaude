import { describe, expect, it } from 'bun:test'
import { DEFAULT_GLOBAL_CONFIG } from '../../utils/config.js'
import { resolveFooterStatusLine } from './PromptInputFooter.js'

const guardsPass = {
  isPromptMode: true,
  isShort: false,
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
    ['exit message showing', { ...guardsPass, exitMessageShown: true }],
    ['paste in progress', { ...guardsPass, isPasting: true }],
  ] as const) {
    it(`renders none while ${name}, for both variants`, () => {
      expect(resolveFooterStatusLine({}, guards)).toBeNull()
      expect(resolveFooterStatusLine(customSettings, guards)).toBeNull()
    })
  }
})
