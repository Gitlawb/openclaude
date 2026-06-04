import { afterEach, describe, expect, test } from 'bun:test'
import {
  builtInCommandNames,
  formatDescriptionWithSource,
} from './commands.js'
import { registerBatchSkill } from './skills/bundled/batch.js'
import { registerDebugSkill } from './skills/bundled/debug.js'
import { registerLoopSkill } from './skills/bundled/loop.js'
import { registerSimplifySkill } from './skills/bundled/simplify.js'
import { registerUpdateConfigSkill } from './skills/bundled/updateConfig.js'
import {
  clearBundledSkills,
  getBundledSkills,
  registerBundledSkill,
} from './skills/bundledSkills.js'
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

  test('translates prompt built-in descriptions using the current language', () => {
    const command = {
      name: 'review',
      type: 'prompt',
      source: 'builtin',
      description: 'Review a pull request',
      localizationKey: 'commands.review.description',
    } as any

    useLanguage('english')
    expect(formatDescriptionWithSource(command)).toBe('Review a pull request')

    useLanguage('vietnamese')
    expect(formatDescriptionWithSource(command)).toBe('Đánh giá pull request')
  })

  test('falls back to English when an OpenClaude localization key is missing', () => {
    const command = {
      name: 'example',
      type: 'prompt',
      source: 'builtin',
      description: 'English fallback description',
      localizationKey: 'commands.example.missing.description',
    } as any

    useLanguage('vietnamese')
    expect(formatDescriptionWithSource(command)).toBe(
      'English fallback description',
    )
  })

  test('does not translate project, policy, workflow, or user-authored descriptions', () => {
    const description = 'Review a pull request'
    const promptCommand = (source: string) =>
      ({
        name: 'external-review',
        type: 'prompt',
        source,
        description,
      }) as any

    useLanguage('vietnamese')

    expect(formatDescriptionWithSource(promptCommand('projectSettings'))).toBe(
      'Review a pull request (project)',
    )
    expect(formatDescriptionWithSource(promptCommand('userSettings'))).toBe(
      'Review a pull request (user)',
    )
    expect(formatDescriptionWithSource(promptCommand('policySettings'))).toBe(
      'Review a pull request (managed)',
    )
    expect(formatDescriptionWithSource(promptCommand('localSettings'))).toBe(
      'Review a pull request (project, gitignored)',
    )
    expect(formatDescriptionWithSource(promptCommand('flagSettings'))).toBe(
      'Review a pull request (cli flag)',
    )
    expect(
      formatDescriptionWithSource({
        ...promptCommand('projectSettings'),
        kind: 'workflow',
      }),
    ).toBe('Review a pull request (workflow)')
  })

  test('does not translate plugin descriptions that match built-in English text', () => {
    const command = {
      name: 'external-review',
      type: 'prompt',
      source: 'plugin',
      description: 'Review a pull request',
      pluginInfo: {
        pluginManifest: {
          name: 'MyPlugin',
        },
      },
    } as any

    useLanguage('vietnamese')

    expect(formatDescriptionWithSource(command)).toBe(
      '(MyPlugin) Review a pull request',
    )
  })

  test('does not translate non-prompt local descriptions without a localization key', () => {
    const command = {
      name: 'external-review',
      type: 'local',
      description: 'Review a pull request',
    } as any

    useLanguage('vietnamese')

    expect(formatDescriptionWithSource(command)).toBe('Review a pull request')
  })

  test('translates non-prompt local descriptions only with an explicit localization key', () => {
    const command = {
      name: 'copy',
      type: 'local',
      description:
        "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)",
      localizationKey: 'commands.copy.description',
    } as any

    useLanguage('vietnamese')
    expect(formatDescriptionWithSource(command)).toBe(
      'Sao chép phản hồi gần nhất của Claude vào clipboard (hoặc /copy N cho phản hồi thứ N gần nhất)',
    )

    useLanguage('english')
    expect(formatDescriptionWithSource(command)).toBe(
      "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)",
    )
  })
})

describe('bundled skill localization', () => {
  test('resolves descriptions from the current language at read time', () => {
    resetSettingsCache()
    clearBundledSkills()
    registerBatchSkill()
    registerDebugSkill()
    registerLoopSkill()
    registerSimplifySkill()
    registerUpdateConfigSkill()
    const batch = getBundledSkills().find(command => command.name === 'batch')
    const debug = getBundledSkills().find(command => command.name === 'debug')
    const loop = getBundledSkills().find(command => command.name === 'loop')
    const simplify = getBundledSkills().find(
      command => command.name === 'simplify',
    )
    const updateConfig = getBundledSkills().find(
      command => command.name === 'update-config',
    )
    const expectedDebugEnglish =
      process.env.USER_TYPE === 'ant'
        ? 'Debug your current Claude Code session by reading the session debug log. Includes all event logging'
        : 'Enable debug logging for this session and help diagnose issues'
    const expectedDebugVietnamese =
      process.env.USER_TYPE === 'ant'
        ? 'Debug phiên Claude Code hiện tại bằng cách đọc debug log của phiên. Bao gồm toàn bộ event logging'
        : 'Bật debug logging cho phiên này và hỗ trợ chẩn đoán sự cố'

    expect(batch).toBeDefined()
    expect(debug).toBeDefined()
    expect(loop).toBeDefined()
    expect(simplify).toBeDefined()
    expect(updateConfig).toBeDefined()
    expect(batch!.localizationKey).toBe('skills.batch.description')
    expect(loop!.localizationKey).toBe('skills.loop.description')
    expect(loop!.whenToUseLocalizationKey).toBe('skills.loop.whenToUse')

    useLanguage('english')
    expect(batch!.description).toBe(
      'Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR.',
    )
    expect(debug!.description).toBe(expectedDebugEnglish)
    expect(loop!.description).toBe(
      'Run a prompt on a fixed interval or dynamically reschedule it, including bare maintenance-mode loops.',
    )
    expect(loop!.whenToUse).toBe(
      'When the user wants to poll for status, babysit a workflow, run recurring maintenance, or keep re-running a prompt within the current session.',
    )
    expect(simplify!.description).toBe(
      'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
    )
    expect(updateConfig!.description).toStartWith(
      'Use this skill to configure the Claude Code harness via settings.json.',
    )

    useLanguage('vietnamese')
    expect(batch!.description).toBe(
      'Nghiên cứu và lập kế hoạch cho một thay đổi quy mô lớn, rồi thực thi song song trên 5–30 agent worktree cô lập, mỗi agent mở một PR.',
    )
    expect(debug!.description).toBe(expectedDebugVietnamese)
    expect(loop!.description).toBe(
      'Chạy một prompt theo khoảng thời gian cố định hoặc lên lịch lại động, bao gồm cả chế độ bảo trì lặp lại.',
    )
    expect(loop!.whenToUse).toBe(
      'Khi người dùng muốn kiểm tra trạng thái, giám sát quy trình, chạy bảo trì định kỳ, hoặc chạy lại một prompt trong phiên hiện tại.',
    )
    expect(simplify!.description).toBe(
      'Đánh giá code đã thay đổi về mặt tái sử dụng, chất lượng và hiệu suất, sau đó sửa các vấn đề tìm được.',
    )
    expect(updateConfig!.description).toStartWith(
      'Sử dụng skill này để cấu hình Claude Code qua settings.json.',
    )

    useLanguage('english')
    expect(loop!.description).toBe(
      'Run a prompt on a fixed interval or dynamically reschedule it, including bare maintenance-mode loops.',
    )
    expect(updateConfig!.description).toStartWith(
      'Use this skill to configure the Claude Code harness via settings.json.',
    )
  })

  test('falls back to bundled skill English text when a localization key is missing', () => {
    registerBundledSkill({
      name: 'fallback-skill',
      description: 'English-only bundled skill description',
      descriptionKey: 'skills.fallback-skill.missing.description',
      getPromptForCommand: async () => [],
    })

    const skill = getBundledSkills().find(
      command => command.name === 'fallback-skill',
    )

    expect(skill).toBeDefined()

    useLanguage('vietnamese')
    expect(skill!.description).toBe('English-only bundled skill description')
    expect(formatDescriptionWithSource(skill!)).toBe(
      'English-only bundled skill description (bundled)',
    )
  })
})
