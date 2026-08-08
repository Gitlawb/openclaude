import { afterEach, describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import type { LocalizationKey } from '../../i18n/index.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
import {
  applyCommandSuggestion,
  findCommandByExactName,
  getBestCommandMatch,
  getCommandSuggestionForEnter,
  getCommandSuggestionsMaxWidth,
  generateCommandSuggestions,
} from './commandSuggestions.js'

function promptCommand({
  name,
  getDescription,
  source = 'builtin',
  kind,
  pluginName,
  localizationKey,
  aliases,
  isHidden,
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
  aliases?: string[]
  isHidden?: boolean
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
    aliases,
    isHidden,
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
  test('renders localized built-in descriptions with a stable command array', () => {
    const commands = [
      promptCommand({
        name: 'review',
        source: 'builtin',
        getDescription: () => 'Review a pull request',
        localizationKey: 'commands.review.description',
      }),
    ]

    useLanguage('english')
    const englishSuggestions = generateCommandSuggestions('/review', commands)
    expect(englishSuggestions[0]?.displayText).toBe('/review')
    expect(englishSuggestions[0]?.description).toBe('Review a pull request')

    useLanguage('vietnamese')
    const suggestions = generateCommandSuggestions('/review', commands)

    expect(suggestions[0]?.displayText).toBe('/review')
    expect(suggestions[0]?.description).toBe(
      '\u0110\u00e1nh gi\u00e1 pull request',
    )
    expect(generateCommandSuggestions('/\u0111\u00e1nh', commands)).toEqual([])
  })

  test('renders localized bundled descriptions with a stable command array', () => {
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
    const englishSuggestion = generateCommandSuggestions('/loop', commands)[0]
    expect(englishSuggestion?.displayText).toBe('/loop')
    expect(englishSuggestion?.description).toContain(
      'Run a prompt on a fixed interval',
    )
    expect(englishSuggestion?.description).toContain('(bundled)')

    useLanguage('vietnamese')
    const loopSuggestion = generateCommandSuggestions('/loop', commands)[0]

    expect(loopSuggestion?.displayText).toBe('/loop')
    expect(loopSuggestion?.description).toContain(
      'kho\u1ea3ng th\u1eddi gian',
    )
    expect(generateCommandSuggestions('/kho\u1ea3ng', commands)).toEqual([])
  })

  test('localizes only OpenClaude-owned descriptions', () => {
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
    const reviewSuggestions = generateCommandSuggestions('/review', commands)

    const builtinSuggestion = reviewSuggestions.find(
      item => item.displayText === '/builtin-review',
    )
    const projectSuggestion = reviewSuggestions.find(
      item => item.displayText === '/project-review',
    )
    const workflowSuggestion = reviewSuggestions.find(
      item => item.displayText === '/workflow-review',
    )

    const pluginSuggestion = generateCommandSuggestions(
      '/plugin-review',
      commands,
    ).find(item => item.displayText === '/plugin-review')

    expect(builtinSuggestion?.description).toBe(
      '\u0110\u00e1nh gi\u00e1 pull request',
    )
    expect(projectSuggestion?.description).toBe('Review a pull request (project)')
    expect(workflowSuggestion?.description).toBe('Review a pull request')
    expect(pluginSuggestion?.description).toBe('(MyPlugin) Review a pull request')
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

  // Regression: typing a command name must narrow the dropdown to matching
  // commands and not leave an unrelated, frequently-used command (e.g.
  // /simplify) sitting in the list.
  test('narrows to the typed command and drops non-matching ones', () => {
    const commands = [
      promptCommand({ name: 'provider', getDescription: () => 'Manage providers' }),
      promptCommand({ name: 'simplify', getDescription: () => 'Simplify the changed code' }),
      promptCommand({ name: 'model', getDescription: () => 'Change model' }),
      promptCommand({ name: 'review', getDescription: () => 'Review a PR' }),
    ]

    expect(
      generateCommandSuggestions('/provider', commands).map(i => i.displayText),
    ).toEqual(['/provider'])

    const partial = generateCommandSuggestions('/pro', commands).map(
      i => i.displayText,
    )
    expect(partial).toContain('/provider')
    expect(partial).not.toContain('/simplify')
  })

  // Regression: a command whose `description` getter throws (e.g. a backend
  // returning null) must not break suggestions for every other command. The
  // Fuse index renders every description, so an unguarded throw here used to
  // reject the whole updateSuggestions() call and freeze the dropdown.
  test('a throwing description getter does not break other suggestions', () => {
    const exploding: Command = {
      type: 'local-jsx',
      name: 'sandbox',
      get description(): string {
        throw new TypeError("Cannot read properties of null (reading 'errors')")
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command

    const commands = [
      exploding,
      promptCommand({ name: 'provider', getDescription: () => 'Manage providers' }),
    ]

    // Must not throw, and must still surface the healthy command.
    expect(
      generateCommandSuggestions('/prov', commands).map(i => i.displayText),
    ).toContain('/provider')
  })

  // Regression: a throwing `isHidden` getter must not break the bare "/" view
  // either, since that path filters every command by isHidden.
  test('a throwing isHidden getter does not break the "/" command list', () => {
    const exploding: Command = {
      type: 'local-jsx',
      name: 'sandbox',
      get description(): string {
        return 'toggle sandbox'
      },
      get isHidden(): boolean {
        throw new TypeError("Cannot read properties of null (reading 'errors')")
      },
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command

    const commands = [
      exploding,
      promptCommand({ name: 'provider', getDescription: () => 'Manage providers' }),
    ]

    const all = generateCommandSuggestions('/', commands).map(i => i.displayText)
    expect(all).toContain('/provider')
    // The command with the broken getter defaults to visible rather than
    // taking down the whole list.
    expect(all).toContain('/sandbox')
  })

  // A command with a broken description getter must still be listed (it's a
  // valid command), just with no description — not silently dropped.
  test('a command with a throwing description getter is still listed', () => {
    const exploding: Command = {
      type: 'local-jsx',
      name: 'sandbox',
      get description(): string {
        throw new Error('boom')
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command

    const result = generateCommandSuggestions('/sandbox', [exploding])
    expect(result.map(i => i.displayText)).toContain('/sandbox')
    expect(result[0]?.description).toBe('')
  })

  // A command whose *name* getter throws can't be addressed at all, so it is
  // dropped — but it must not break the rest of the list.
  test('a command whose name getter throws is dropped, others survive', () => {
    const unnameable: Command = {
      type: 'local-jsx',
      get name(): string {
        throw new Error('no name')
      },
      get description(): string {
        return 'broken'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command

    const commands = [
      unnameable,
      promptCommand({
        name: 'provider',
        getDescription: () => 'Manage providers',
      }),
    ]

    expect(() =>
      generateCommandSuggestions('/prov', commands),
    ).not.toThrow()
    expect(
      generateCommandSuggestions('/prov', commands).map(i => i.displayText),
    ).toContain('/provider')
  })

  test('a command whose name getter throws is dropped from the bare "/" list', () => {
    const unnameable: Command = {
      type: 'local-jsx',
      get name(): string {
        throw new Error('no name')
      },
      get description(): string {
        return 'broken'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command

    const commands = [
      unnameable,
      promptCommand({
        name: 'provider',
        getDescription: () => 'Manage providers',
      }),
    ]

    expect(() => generateCommandSuggestions('/', commands)).not.toThrow()
    expect(
      generateCommandSuggestions('/', commands).map(i => i.displayText),
    ).toEqual(['/provider'])
  })

  test('a throwing alias getter does not break typed suggestions', () => {
    const brokenAlias: Command = {
      type: 'local-jsx',
      name: 'help',
      get aliases(): string[] {
        throw new Error('no aliases')
      },
      get description(): string {
        return 'Display help'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command

    expect(() =>
      generateCommandSuggestions('/help', [brokenAlias]),
    ).not.toThrow()
    expect(
      generateCommandSuggestions('/help', [brokenAlias]).map(i => i.displayText),
    ).toEqual(['/help'])
  })

  test('a throwing isHidden getter does not break typed suggestions', () => {
    const brokenHidden: Command = {
      type: 'local-jsx',
      name: 'provider',
      get description(): string {
        return 'Manage providers'
      },
      get isHidden(): boolean {
        throw new Error('no hidden state')
      },
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command

    expect(() =>
      generateCommandSuggestions('/prov', [brokenHidden]),
    ).not.toThrow()
    expect(
      generateCommandSuggestions('/prov', [brokenHidden]).map(i => i.displayText),
    ).toEqual(['/provider'])
  })

  test('exact-name Enter ignores commands whose name getter throws', () => {
    const unnameable: Command = {
      type: 'local-jsx',
      get name(): string {
        throw new Error('no name')
      },
      get description(): string {
        return 'broken'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const provider = promptCommand({
      name: 'provider',
      getDescription: () => 'Manage providers',
    })
    const commands = [unnameable, provider]
    const suggestion = generateCommandSuggestions('/prov', commands)[0]

    expect(() =>
      getCommandSuggestionForEnter('/provider', suggestion, commands),
    ).not.toThrow()
    expect(getCommandSuggestionForEnter('/provider', suggestion, commands)).toBe(
      'provider',
    )
  })

  test('exact command lookup ignores commands whose name getter throws', () => {
    const unnameable: Command = {
      type: 'local-jsx',
      get name(): string {
        throw new Error('no name')
      },
      get description(): string {
        return 'broken'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const provider = promptCommand({
      name: 'provider',
      getDescription: () => 'Manage providers',
    })

    expect(() =>
      findCommandByExactName([unnameable, provider], 'provider'),
    ).not.toThrow()
    expect(findCommandByExactName([unnameable, provider], 'provider')).toBe(
      provider,
    )
  })

  test('best prefix lookup ignores commands whose name getter starts throwing after indexing', () => {
    let nameReads = 0
    const flakyName: Command = {
      type: 'local-jsx',
      get name(): string {
        nameReads += 1
        if (nameReads > 1) {
          throw new Error('name changed')
        }
        return 'problem'
      },
      get description(): string {
        return 'Problem command'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const provider = promptCommand({
      name: 'provider',
      getDescription: () => 'Manage providers',
    })
    let match: ReturnType<typeof getBestCommandMatch> | undefined

    expect(() => {
      match = getBestCommandMatch('pro', [flakyName, provider])
    }).not.toThrow()
    expect(match).toEqual({ suffix: 'vider', fullCommand: 'provider' })
  })

  test('applying a visible command suggestion survives a name getter that starts throwing after render', () => {
    let nameReads = 0
    const flakyName: Command = {
      type: 'local-jsx',
      get name(): string {
        nameReads += 1
        if (nameReads > 1) {
          throw new Error('name changed')
        }
        return 'problem'
      },
      get description(): string {
        return 'Problem command'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const suggestion = generateCommandSuggestions('/pro', [flakyName])[0]
    let submittedValue: string | undefined
    let submittedOverride: Command | undefined

    expect(suggestion?.displayText).toBe('/problem')
    expect(() =>
      applyCommandSuggestion(
        suggestion!,
        true,
        [flakyName],
        value => {
          submittedValue = value
        },
        () => {},
        (value, _isSlashCommand, override) => {
          submittedValue = value
          submittedOverride = override
        },
      ),
    ).not.toThrow()
    expect(submittedValue).toBe('/problem ')
    expect(submittedOverride).toBe(flakyName)
  })

  test('exact string application uses safe command lookup when earlier command metadata is broken', () => {
    const unnameable: Command = {
      type: 'local-jsx',
      get name(): string {
        throw new Error('no name')
      },
      get description(): string {
        return 'broken'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const provider = promptCommand({
      name: 'provider',
      getDescription: () => 'Manage providers',
    })
    let submittedValue: string | undefined
    let submittedOverride: Command | undefined

    expect(() =>
      applyCommandSuggestion(
        'provider',
        true,
        [unnameable, provider],
        value => {
          submittedValue = value
        },
        () => {},
        (value, _isSlashCommand, override) => {
          submittedValue = value
          submittedOverride = override
        },
      ),
    ).not.toThrow()
    expect(submittedValue).toBe('/provider ')
    expect(submittedOverride).toBe(provider)
  })

  test('max-width calculation ignores unnameable commands and survives hidden getter failures', () => {
    const unnameable: Command = {
      type: 'local-jsx',
      get name(): string {
        throw new Error('no name')
      },
      get description(): string {
        return 'broken'
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const brokenHidden: Command = {
      type: 'local-jsx',
      name: 'wide-command',
      get description(): string {
        return 'Wide command'
      },
      get isHidden(): boolean {
        throw new Error('no hidden state')
      },
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const metadataPoisoned: Command = {
      type: 'local-jsx',
      name: 'metadata-poisoned-command',
      get aliases(): string[] {
        throw new Error('aliases should not be read')
      },
      get description(): string {
        throw new Error('description should not be read')
      },
      isHidden: false,
      progressMessage: 'running',
      contentLength: 0,
      getPromptForCommand: async () => [],
    } as unknown as Command
    const hidden = promptCommand({
      name: 'hidden-but-wider-command',
      getDescription: () => 'Hidden command',
      isHidden: true,
    })

    expect(() =>
      getCommandSuggestionsMaxWidth([
        unnameable,
        brokenHidden,
        metadataPoisoned,
        hidden,
      ]),
    ).not.toThrow()
    expect(
      getCommandSuggestionsMaxWidth([
        unnameable,
        brokenHidden,
        metadataPoisoned,
        hidden,
      ]),
    ).toBe('metadata-poisoned-command'.length + 6)
  })

  // The highlight in the dropdown is index 0, so the FIRST result must be the
  // best (shortest exact-prefix) match — this is what stops the selection from
  // sticking to an unrelated recently-used command like /simplify.
  test('ranks the best prefix match first (drives the index-0 highlight)', () => {
    const commands = [
      promptCommand({ name: 'simplify', getDescription: () => 'Simplify code' }),
      promptCommand({ name: 'permissions', getDescription: () => 'Permissions' }),
      promptCommand({ name: 'pr-comments', getDescription: () => 'PR comments' }),
      promptCommand({ name: 'provider', getDescription: () => 'Providers' }),
    ]

    expect(generateCommandSuggestions('/p', commands)[0]?.displayText).toBe(
      '/provider',
    )
    expect(generateCommandSuggestions('/pe', commands)[0]?.displayText).toBe(
      '/permissions',
    )
  })
})

describe('generateCommandSuggestions identifier filtering', () => {
  // Fixture chosen so that WITHOUT the pruning fix, Fuse returns all five
  // commands for /c (verified empirically: [/cost, /clear, /compact,
  // /context, /release-notes]). With the fix, only the four commands whose
  // name starts with 'c' survive.
  function buildCommands() {
    return [
      promptCommand({
        name: 'clear',
        getDescription: () => 'Clear conversation',
      }),
      promptCommand({
        name: 'compact',
        getDescription: () => 'Compact and summarize the conversation',
      }),
      promptCommand({
        name: 'context',
        getDescription: () => 'Manage context windows',
      }),
      promptCommand({
        name: 'cost',
        getDescription: () => 'Show token usage and cost',
      }),
      promptCommand({
        name: 'release-notes',
        getDescription: () => 'Show changes concerning configuration',
      }),
    ]
  }

  test('one-letter prefix prunes description-only matches to exactly the name-prefix set', () => {
    const names = generateCommandSuggestions('/c', buildCommands()).map(
      item => item.displayText,
    )

    // Exact-set assertion (order-independent). arrayContaining would pass
    // even with the fix reverted; this fails.
    expect(names.sort()).toEqual(
      ['/clear', '/compact', '/context', '/cost'].sort(),
    )
  })

  test('two-letter prefix prunes both description matches AND non-prefix name matches', () => {
    // Without the fix, Fuse also returns /clear (fuzzy on "Compact and
    // summarize..."). The fix must drop both /clear and /release-notes.
    const names = generateCommandSuggestions('/co', buildCommands()).map(
      item => item.displayText,
    )

    expect(names.sort()).toEqual(
      ['/compact', '/context', '/cost'].sort(),
    )
  })

  test('three-letter query drops description-only matches when no typed characters appear in command identifiers', () => {
    // 'len' is > 2 and matches nothing in the command name, aliases, or
    // separator-delimited command parts. Description-only matches should not
    // appear in slash typeahead.
    const commands = [
      promptCommand({
        name: 'review',
        getDescription: () => 'Review a pull request with length checks',
      }),
      promptCommand({
        name: 'cost',
        getDescription: () => 'Show token usage and cost',
      }),
    ]

    const names = generateCommandSuggestions('/len', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual([])
  })

  test('substring name match is kept while description-only matches are dropped', () => {
    const commands = [
      promptCommand({
        name: 'review',
        getDescription: () => 'Review a pull request',
      }),
      promptCommand({
        name: 'status',
        getDescription: () => 'Show a detailed view of status',
      }),
    ]

    const names = generateCommandSuggestions('/view', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual(['/review'])
  })

  test('substring name match does not depend on Fuse returning the command', () => {
    const longCommandName = `prefix-${'a'.repeat(160)}needle`
    const commands = [
      promptCommand({
        name: longCommandName,
        getDescription: () => 'Long command name',
      }),
    ]

    const names = generateCommandSuggestions('/needle', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual([`/${longCommandName}`])
  })

  test('substring after a separator is kept while description-only matches are dropped', () => {
    const commands = [
      promptCommand({
        name: 'agents-consilium',
        getDescription: () => 'Manage agent council sessions',
      }),
      promptCommand({
        name: 'status',
        getDescription: () => 'Display consilium status',
      }),
    ]

    const names = generateCommandSuggestions('/sili', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual(['/agents-consilium'])
  })

  test('single-character query with no identifier substring matches returns empty results', () => {
    // No command identifier contains 'z', but Fuse can match description text
    // such as "summarize". Slash typeahead should drop description-only
    // matches even at length 1.
    const names = generateCommandSuggestions('/z', buildCommands()).map(
      item => item.displayText,
    )

    expect(names).toEqual([])
  })

  test('query with zero results returns empty array without crashing', () => {
    const names = generateCommandSuggestions('/qq', buildCommands()).map(
      item => item.displayText,
    )

    expect(names).toEqual([])
  })

  test('word-boundary on hyphenated name counts as a prefix match', () => {
    const commands = [
      promptCommand({
        name: 'memory-show',
        getDescription: () => 'Show memory contents',
      }),
      promptCommand({
        name: 'summary',
        getDescription: () => 'Summarize what the memory tool can do',
      }),
    ]

    const names = generateCommandSuggestions('/show', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual(['/memory-show'])
  })

  test('word-boundary on underscore-separated name counts as a prefix match', () => {
    const commands = [
      promptCommand({
        name: 'user_profile',
        getDescription: () => 'Show the user profile',
      }),
      promptCommand({
        name: 'profiler',
        getDescription: () => 'CPU profiler that has nothing to do with users',
      }),
    ]

    const names = generateCommandSuggestions('/profile', commands).map(
      item => item.displayText,
    )

    // /profile is a prefix of 'profiler' (name) and a word-boundary match on
    // 'user_profile'. Both should survive.
    expect(names.sort()).toEqual(['/profiler', '/user_profile'].sort())
  })

  test('word-boundary on colon-separated name counts as a prefix match', () => {
    const commands = [
      promptCommand({
        name: 'plugin:reload',
        getDescription: () => 'Reload a plugin',
      }),
      promptCommand({
        name: 'reloader',
        getDescription: () => 'Background reloader for unrelated tasks',
      }),
    ]

    const names = generateCommandSuggestions('/reload', commands).map(
      item => item.displayText,
    )

    expect(names.sort()).toEqual(['/plugin:reload', '/reloader'].sort())
  })

  test('separator-delimited part prefix survives alongside name prefix matches', () => {
    const commands = [
      promptCommand({
        name: 'x-release-yyy',
        getDescription: () => 'release notes for x',
      }),
      promptCommand({
        name: 'reboot',
        getDescription: () => 'restart everything',
      }),
    ]

    const names = generateCommandSuggestions('/re', commands).map(
      item => item.displayText,
    )

    expect(names.sort()).toEqual(['/reboot', '/x-release-yyy'].sort())
  })

  test('ranks exact, alias, prefix, part-prefix, and substring identifier matches in that order', () => {
    const commands = [
      promptCommand({
        name: 'review',
        getDescription: () => 'Substring name match',
      }),
      promptCommand({
        name: 'thing-view',
        getDescription: () => 'Part prefix match',
      }),
      promptCommand({
        name: 'help',
        aliases: ['view'],
        getDescription: () => 'Exact alias match',
      }),
      promptCommand({
        name: 'view-all',
        getDescription: () => 'Prefix name match',
      }),
      promptCommand({
        name: 'view',
        getDescription: () => 'Exact name match',
      }),
      promptCommand({
        name: 'status',
        getDescription: () => 'Description-only view match',
      }),
    ]

    const names = generateCommandSuggestions('/view', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual([
      '/view',
      '/help (view)',
      '/view-all',
      '/thing-view',
      '/review',
    ])
  })

  test('hidden exact command is still prepended without letting hidden commands join substring results', () => {
    const commands = [
      promptCommand({
        name: 'voice',
        getDescription: () => 'Hidden exact command',
        isHidden: true,
      }),
      promptCommand({
        name: 'voice-memo',
        getDescription: () => 'Visible prefix sibling',
      }),
      promptCommand({
        name: 'invoice',
        getDescription: () => 'Visible substring sibling',
      }),
      promptCommand({
        name: 'hidden-voice-helper',
        getDescription: () => 'Hidden substring sibling',
        isHidden: true,
      }),
    ]

    const names = generateCommandSuggestions('/voice', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual(['/voice', '/voice-memo', '/invoice'])
  })

  test('alias prefix match is kept, and a non-matching name with overlapping description is dropped', () => {
    const commands = [
      promptCommand({
        name: 'documentation',
        aliases: ['docs'],
        getDescription: () => 'Show the docs',
      }),
      promptCommand({
        name: 'disk-usage',
        getDescription: () => 'Display docs-related disk metrics',
      }),
    ]

    const names = generateCommandSuggestions('/doc', commands).map(
      item => item.displayText,
    )

    // /documentation matches by name prefix and alias prefix; /disk-usage's
    // only relation to 'doc' is via description.
    expect(names).toEqual(['/documentation (docs)'])
  })

  test('alias substring match is kept while description-only matches are dropped', () => {
    const commands = [
      promptCommand({
        name: 'help',
        aliases: ['sosextra'],
        getDescription: () => 'Display help information',
      }),
      promptCommand({
        name: 'status',
        getDescription: () => 'Display extra status information',
      }),
    ]

    const names = generateCommandSuggestions('/extra', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual(['/help (sosextra)'])
  })

  test('alias that prefix-matches the query saves a command whose name does not', () => {
    const commands = [
      promptCommand({
        name: 'help',
        aliases: ['halp', 'sosextra'],
        getDescription: () => 'Display help information',
      }),
      promptCommand({
        name: 'housekeeping',
        getDescription: () => 'Clean caches to help with disk space',
      }),
    ]

    // 'sosextra' is the only alias prefix-matched by 'sos'. The fix must
    // surface /help via its alias and drop /housekeeping (description-only).
    const names = generateCommandSuggestions('/sos', commands).map(
      item => item.displayText,
    )

    expect(names).toEqual(['/help (sosextra)'])
  })
})
