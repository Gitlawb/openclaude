import { afterEach, describe, expect, test } from 'bun:test'
import { getNativeInstallUnavailableFix } from './doctorDiagnostic.js'

const originalMacro = (globalThis as Record<string, unknown>).MACRO

afterEach(() => {
  if (originalMacro === undefined) {
    delete (globalThis as Record<string, unknown>).MACRO
  } else {
    ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  }
})

describe('getNativeInstallUnavailableFix', () => {
  test('uses npm guidance when this build has no native distribution', () => {
    ;(globalThis as Record<string, unknown>).MACRO = {
      PACKAGE_URL: '@gitlawb/openclaude',
    }

    for (const reason of [
      'local-config',
      'local-overlap',
      'global-permissions',
      'native-config',
    ] as const) {
      const fix = getNativeInstallUnavailableFix(reason, false)
      expect(fix).toContain('npm install -g @gitlawb/openclaude@latest')
      expect(fix).not.toContain('openclaude install')
      expect(fix).not.toContain('native installation')
    }
  })

  test('preserves native install guidance for native-capable builds', () => {
    ;(globalThis as Record<string, unknown>).MACRO = {
      PACKAGE_URL: '@gitlawb/openclaude',
    }

    expect(getNativeInstallUnavailableFix('local-config', true)).toContain(
      'openclaude install',
    )
    expect(getNativeInstallUnavailableFix('global-permissions', true)).toContain(
      'native installation',
    )
  })
})
