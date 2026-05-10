import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_LOGO_PALETTE,
  LOGO_PALETTE_NAMES,
  LOGO_PALETTES,
  isLogoPaletteName,
  resolveLogoPalette,
} from './StartupScreen.palettes.js'

describe('startup logo palettes', () => {
  test('valid palette names resolve to their palette', () => {
    for (const name of LOGO_PALETTE_NAMES) {
      expect(isLogoPaletteName(name)).toBe(true)
      expect(resolveLogoPalette(name)).toBe(LOGO_PALETTES[name])
    }
  })

  test('missing and invalid palette names fall back to the default', () => {
    expect(resolveLogoPalette(undefined)).toBe(LOGO_PALETTES[DEFAULT_LOGO_PALETTE])
    expect(resolveLogoPalette('not-a-palette')).toBe(
      LOGO_PALETTES[DEFAULT_LOGO_PALETTE],
    )
    expect(isLogoPaletteName('not-a-palette')).toBe(false)
  })

  test('palette names stay in sync with defined palettes', () => {
    expect(LOGO_PALETTE_NAMES).toEqual(Object.keys(LOGO_PALETTES))
  })
})
