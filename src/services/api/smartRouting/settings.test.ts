import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { readSmartRouting } from './settings.js'
import type { SettingsJson } from '../../../utils/settings/types.js'

function settingsWith(smartRouting: unknown): SettingsJson {
  return { smartRouting } as unknown as SettingsJson
}

describe('readSmartRouting', () => {
  afterEach(() => {
    // Restore any console spies between tests.
  })

  test('absent block normalizes to disabled, no warning', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    expect(readSmartRouting(null)).toEqual({ enabled: false })
    expect(readSmartRouting({} as SettingsJson)).toEqual({ enabled: false })
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('explicitly disabled normalizes to disabled, no warning', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    expect(readSmartRouting(settingsWith({ enabled: false, simpleModel: 'mini', strongModel: 'main' }))).toEqual({
      enabled: false,
    })
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('enabled with both roles carries both and passes thresholds through', () => {
    const result = readSmartRouting(
      settingsWith({ enabled: true, simpleModel: 'mini', strongModel: 'main', simpleMaxChars: 200, simpleMaxWords: 40 }),
    )
    expect(result).toEqual({
      enabled: true,
      simpleModel: 'mini',
      strongModel: 'main',
      simpleMaxChars: 200,
      simpleMaxWords: 40,
    })
  })

  test('enabled but strongModel missing normalizes to disabled with one warning', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    expect(readSmartRouting(settingsWith({ enabled: true, simpleModel: 'mini' }))).toEqual({ enabled: false })
    expect(errSpy).toHaveBeenCalledTimes(1)
    errSpy.mockRestore()
  })

  test('strongModel present but simpleModel missing stays enabled (routeModel collapses to strong)', () => {
    const result = readSmartRouting(settingsWith({ enabled: true, strongModel: 'main' }))
    expect(result.enabled).toBe(true)
    expect(result.strongModel).toBe('main')
    expect(result.simpleModel).toBeUndefined()
  })

  test('non-numeric or non-positive thresholds are dropped so classifier defaults apply', () => {
    const result = readSmartRouting(
      settingsWith({
        enabled: true,
        simpleModel: 'mini',
        strongModel: 'main',
        simpleMaxChars: -5,
        simpleMaxWords: Number.NaN,
      }),
    )
    expect(result.simpleMaxChars).toBeUndefined()
    expect(result.simpleMaxWords).toBeUndefined()
  })

  test('whitespace-only role strings are treated as absent', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    // strong is whitespace -> treated as missing -> disabled + warning
    expect(readSmartRouting(settingsWith({ enabled: true, simpleModel: 'mini', strongModel: '   ' }))).toEqual({
      enabled: false,
    })
    errSpy.mockRestore()
  })

  describe('env fallback (settings override env)', () => {
    test('env enables routing when settings say nothing', () => {
      const env = {
        OPENCLAUDE_SMART_ROUTING: '1',
        OPENCLAUDE_SMART_ROUTING_SIMPLE: 'mini',
        OPENCLAUDE_SMART_ROUTING_STRONG: 'main',
      } as unknown as NodeJS.ProcessEnv
      expect(readSmartRouting(null, env)).toEqual({
        enabled: true,
        simpleModel: 'mini',
        strongModel: 'main',
        simpleMaxChars: undefined,
        simpleMaxWords: undefined,
      })
    })

    test('settings block present (even disabled) overrides env', () => {
      const env = {
        OPENCLAUDE_SMART_ROUTING: '1',
        OPENCLAUDE_SMART_ROUTING_SIMPLE: 'mini',
        OPENCLAUDE_SMART_ROUTING_STRONG: 'main',
      } as unknown as NodeJS.ProcessEnv
      // settings explicitly disables -> env's enable does not apply
      expect(readSmartRouting(settingsWith({ enabled: false }), env)).toEqual({ enabled: false })
    })

    test('no env and no settings is disabled', () => {
      expect(readSmartRouting(null, {} as NodeJS.ProcessEnv)).toEqual({ enabled: false })
    })
  })
})
