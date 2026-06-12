import { afterEach, describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import type { LocalizationKey } from '../../i18n/index.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
import {
  applyCommandSuggestion,
  getCommandSuggestionForEnter,
  generateCommandSuggestions,
} from './commandSuggestions.js'

function promptCommand({
  name,
  getDescription,
  source = 'builtin',
  kind,
  pluginName,
  localizationKey,
}: {
  name: string
  getDescription: () => string
  source?:
    | 'builtin'
    | 'bundled'
    | 'mcp'
    | 'plugin'
    | 'projectSettings'
    | 'userSettings'
    | 'policySettings'
  kind?: 'workflow'
  pluginName?: string
  localizationKey?: LocalizationKey
}): Command {
  return {
    type: 'prompt',
    name,
    get description() {
      return getDescription()
    },
    source,
    kind,
    localizationKey,
    pluginInfo: pluginName
      ? {
          pluginManifest: {
            name: pluginName,
          },
          repository: 'test',
        }
      : undefined,
    progressMessage: 'running',
    contentLength: 0,
    getPromptForCommand: async () => [],
  } as Command
}

function useLanguage(language?: string): void {
  setSessionSettingsCache({
    settings: language ? { language } : {},
    errors: [],
  })
}

afterEach(() => {
  resetSettingsCache()
})

describe('generateCommandSuggestions localization', () => {
  test('searches localized built-in descriptions with a stable command array', () => {
    const commands = [
      promptCommand({
        name: 'review',
        source: 'builtin',
        getDescription: () => 'Review a pull request',
        localizationKey: 'commands.review.description',
      }),
    ]

    useLanguage('english')
    expect(
      generateCommandSuggestions('/pull', commands).map(
        item => item.displayText,
      ),
    ).toContain('/review')

    useLanguage('vietnamese')
    const suggestions = generateCommandSuggestions('/\u0111\u00e1nh', commands)

    expect(suggestions[0]?.displayText).toBe('/review')
    expect(suggestions[0]?.description).toBe(
      '\u0110\u00e1nh gi\u00e1 pull request',
    )

    useLanguage('english')
    const englishSuggestions = generateCommandSuggestions('/pull', commands)
    expect(englishSuggestions[0]?.displayText).toBe('/review')
    expect(englishSuggestions[0]?.description).toBe('Review a pull request')
  })

  test('searches localized bundled descriptions with a stable command array', () => {
    const commands = [
      promptCommand({
        name: 'loop',
        source: 'bundled',
        getDescription: () =>
          'Run a prompt on a fixed interval or dynamically reschedule it.',
        localizationKey: 'skills.loop.description',
      }),
    ]

    useLanguage('english')
    expect(
      generateCommandSuggestions('/interval', commands).map(
        item => item.displayText,
      ),
    ).toContain('/loop')

    useLanguage('vietnamese')
    const suggestions = generateCommandSuggestions('/kho\u1ea3ng', commands)
    const loopSuggestion = suggestions.find(item => item.displayText === '/loop')

    expect(loopSuggestion).toBeDefined()
    expect(loopSuggestion?.description).toContain(
      'kho\u1ea3ng th\u1eddi gian',
    )
  })

  test('does not index external English descriptions as Vietnamese text', () => {
    const commands = [
      promptCommand({
        name: 'project-review',
        source: 'projectSettings',
        getDescription: () => 'Review a pull request',
      }),
      promptCommand({
        name: 'plugin-review',
        source: 'plugin',
        getDescription: () => 'Review a pull request',
        pluginName: 'MyPlugin',
      }),
      promptCommand({
        name: 'workflow-review',
        source: 'projectSettings',
        kind: 'workflow',
        getDescription: () => 'Review a pull request',
      }),
      promptCommand({
        name: 'builtin-review',
        source: 'builtin',
        getDescription: () => 'Review a pull request',
        localizationKey: 'commands.review.description',
      }),
    ]

    useLanguage('vietnamese')
    const vietnameseMatches = generateCommandSuggestions(
      '/\u0111\u00e1nh',
      commands,
    ).map(item => item.displayText)

    expect(vietnameseMatches).toContain('/builtin-review')
    expect(vietnameseMatches).not.toContain('/project-review')
    expect(vietnameseMatches).not.toContain('/plugin-review')
    expect(vietnameseMatches).not.toContain('/workflow-review')

    const pluginSuggestion = generateCommandSuggestions(
      '/plugin-review',
      commands,
    ).find(item => item.displayText === '/plugin-review')

    expect(pluginSuggestion?.description).toBe(
      '(MyPlugin) Review a pull request',
    )
  })

  test('passes the selected duplicate command row as the slash command override', () => {
    const builtinReview = promptCommand({
      name: 'review',
      source: 'builtin',
      getDescription: () => 'Builtin review',
    })
    const projectReview = promptCommand({
      name: 'review',
      source: 'projectSettings',
      getDescription: () => 'Project review',
    })
    const commands = [builtinReview, projectReview]
    const projectSuggestion = generateCommandSuggestions('/review', commands).find(
      item => item.metadata === projectReview,
    )
    let submittedValue: string | undefined
    let submittedOverride: Command | undefined

    expect(projectSuggestion).toBeDefined()
    applyCommandSuggestion(
      projectSuggestion!,
      true,
      commands,
      value => {
        submittedValue = value
      },
      () => {},
      (value, _isSlashCommand, override) => {
        submittedValue = value
        submittedOverride = override
      },
    )

    expect(submittedValue).toBe('/review ')
    expect(submittedOverride).toBe(projectReview)
  })

  test('keeps the selected duplicate command row for exact-name Enter', () => {
    const builtinReview = promptCommand({
      name: 'review',
      source: 'builtin',
      getDescription: () => 'Builtin review',
    })
    const projectReview = promptCommand({
      name: 'review',
      source: 'projectSettings',
      getDescription: () => 'Project review',
    })
    const commands = [builtinReview, projectReview]
    const projectSuggestion = generateCommandSuggestions('/review', commands).find(
      item => item.metadata === projectReview,
    )

    expect(
      getCommandSuggestionForEnter('/review', projectSuggestion, commands),
    ).toBe(projectSuggestion)
  })

  test('normalizes exact-name Enter when there is only one matching command', () => {
    const review = promptCommand({
      name: 'review',
      source: 'builtin',
      getDescription: () => 'Builtin review',
    })
    const suggestion = generateCommandSuggestions('/Review', [review])[0]

    expect(getCommandSuggestionForEnter('/Review', suggestion, [review])).toBe(
      'review',
    )
  })
})
