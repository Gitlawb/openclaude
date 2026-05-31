import { afterEach, describe, expect, test } from 'bun:test'
import {
  builtInCommandNames,
  formatDescriptionWithSource,
} from './commands.js'
import { registerLoopSkill } from './skills/bundled/loop.js'
import { clearBundledSkills, getBundledSkills } from './skills/bundledSkills.js'
import { isCommand } from './types/command.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from './utils/settings/settingsCache.js'

function useLanguage(language?: string): void {
  setSessionSettingsCache({
    settings: language ? { language } : {},
    errors: [],
  })
}

afterEach(() => {
  resetSettingsCache()
  clearBundledSkills()
})

describe('builtInCommandNames', () => {
  test('includes the LSP command', () => {
    expect(builtInCommandNames()).toContain('lsp')
  })

  test('includes the request-size diagnostic command', () => {
    expect(builtInCommandNames()).toContain('request-size')
  })

  test('includes the /dream command', () => {
    expect(builtInCommandNames()).toContain('dream')
  })
})

describe('isCommand', () => {
  test('rejects generated missing-module noop stubs', () => {
    function noop19() {
      return null
    }

    expect(isCommand(noop19)).toBe(false)
    expect(isCommand({ isHidden: true, name: 'stub' })).toBe(false)
  })

  test('accepts real command objects', () => {
    expect(
      isCommand({
        type: 'local',
        name: 'example',
        description: 'example command',
        supportsNonInteractive: false,
        load: async () => ({
          call: async () => ({ type: 'skip' }),
        }),
      }),
    ).toBe(true)
  })
})

describe('formatDescriptionWithSource', () => {
  test('returns empty text for prompt commands missing a description', () => {
    const command = {
      name: 'example',
      type: 'prompt',
      source: 'builtin',
      description: undefined,
    } as any

    expect(formatDescriptionWithSource(command)).toBe('')
  })

  test('formats plugin commands with missing description safely', () => {
    const command = {
      name: 'example',
      type: 'prompt',
      source: 'plugin',
      description: undefined,
      pluginInfo: {
        pluginManifest: {
          name: 'MyPlugin',
        },
      },
    } as any

    expect(formatDescriptionWithSource(command)).toBe('(MyPlugin) ')
  })
})

describe('bundled skill localization', () => {
  test('resolves descriptions from the current language at read time', () => {
    resetSettingsCache()
    clearBundledSkills()
    registerLoopSkill()
    const loop = getBundledSkills().find(command => command.name === 'loop')

    expect(loop).toBeDefined()

    useLanguage('english')
    expect(loop!.description).toBe(
      'Run a prompt on a fixed interval or dynamically reschedule it, including bare maintenance-mode loops.',
    )
    expect(loop!.whenToUse).toBe(
      'When the user wants to poll for status, babysit a workflow, run recurring maintenance, or keep re-running a prompt within the current session.',
    )

    useLanguage('vietnamese')
    expect(loop!.description).toBe(
      'Chạy một prompt theo khoảng thời gian cố định hoặc lên lịch lại động, bao gồm cả chế độ bảo trì lặp lại.',
    )
    expect(loop!.whenToUse).toBe(
      'Khi người dùng muốn kiểm tra trạng thái, giám sát quy trình, chạy bảo trì định kỳ, hoặc chạy lại một prompt trong phiên hiện tại.',
    )
  })
})
