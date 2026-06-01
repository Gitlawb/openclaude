import { describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import { generateCommandSuggestions } from './commandSuggestions.js'

function promptCommand({
  name,
  getDescription,
  source = 'builtin',
}: {
  name: string
  getDescription: () => string
  source?: 'builtin' | 'bundled'
}): Command {
  return {
    type: 'prompt',
    name,
    get description() {
      return getDescription()
    },
    source,
    progressMessage: 'running',
    contentLength: 0,
    getPromptForCommand: async () => [],
  } as Command
}

describe('generateCommandSuggestions localization', () => {
  test('searches changed rendered prompt descriptions with a stable command array', () => {
    let description = 'Review a pull request'
    const commands = [
      promptCommand({
        name: 'review',
        getDescription: () => description,
      }),
    ]

    expect(
      generateCommandSuggestions('/pull', commands).map(
        item => item.displayText,
      ),
    ).toContain('/review')

    description = '\u0110\u00e1nh gi\u00e1 pull request'
    const suggestions = generateCommandSuggestions('/\u0111\u00e1nh', commands)

    expect(suggestions[0]?.displayText).toBe('/review')
    expect(suggestions[0]?.description).toBe(
      '\u0110\u00e1nh gi\u00e1 pull request',
    )
  })

  test('searches changed bundled descriptions with a stable command array', () => {
    let description =
      'Run a prompt on a fixed interval or dynamically reschedule it.'
    const commands = [
      promptCommand({
        name: 'loop',
        source: 'bundled',
        getDescription: () => description,
      }),
    ]

    expect(
      generateCommandSuggestions('/interval', commands).map(
        item => item.displayText,
      ),
    ).toContain('/loop')

    description =
      'Ch\u1ea1y m\u1ed9t prompt theo kho\u1ea3ng th\u1eddi gian c\u1ed1 \u0111\u1ecbnh.'
    const suggestions = generateCommandSuggestions('/kho\u1ea3ng', commands)
    const loopSuggestion = suggestions.find(item => item.displayText === '/loop')

    expect(loopSuggestion).toBeDefined()
    expect(loopSuggestion?.description).toContain(
      'kho\u1ea3ng th\u1eddi gian',
    )
  })
})
