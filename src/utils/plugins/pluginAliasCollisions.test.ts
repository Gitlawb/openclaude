import { describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import { removeCollidingPluginAliases } from './pluginAliasCollisions.js'

function promptCommand(
  name: string,
  options: {
    aliases?: string[]
    source?: 'builtin' | 'plugin' | 'mcp' | 'bundled'
    loadedFrom?: Command['loadedFrom']
  } = {},
): Command {
  return {
    type: 'prompt',
    name,
    aliases: options.aliases,
    description: name + ' description',
    progressMessage: 'loading',
    contentLength: 0,
    source: options.source ?? 'builtin',
    loadedFrom: options.loadedFrom,
    async getPromptForCommand() {
      return []
    },
  }
}

describe('removeCollidingPluginAliases', () => {
  test('removes direct aliases that collide with command names', () => {
    const commands = removeCollidingPluginAliases([
      promptCommand('compound-engineering:help', {
        source: 'plugin',
        loadedFrom: 'plugin',
        aliases: ['help', 'ce-help'],
      }),
      promptCommand('help'),
    ])

    expect(commands[0]?.name).toBe('compound-engineering:help')
    expect(commands[0]?.aliases).toEqual(['ce-help'])
  })

  test('removes direct aliases that collide with existing aliases', () => {
    const commands = removeCollidingPluginAliases([
      promptCommand('compound-engineering:continue', {
        source: 'plugin',
        loadedFrom: 'plugin',
        aliases: ['continue', 'ce-continue'],
      }),
      promptCommand('resume', { aliases: ['continue'] }),
    ])

    expect(commands[0]?.aliases).toEqual(['ce-continue'])
  })

  test('keeps the first plugin alias and removes later duplicate plugin aliases', () => {
    const commands = removeCollidingPluginAliases([
      promptCommand('compound-engineering:ce-plan', {
        source: 'plugin',
        loadedFrom: 'plugin',
        aliases: ['ce-plan'],
      }),
      promptCommand('other-plugin:ce-plan', {
        source: 'plugin',
        loadedFrom: 'plugin',
        aliases: ['ce-plan'],
      }),
    ])

    expect(commands[0]?.aliases).toEqual(['ce-plan'])
    expect(commands[1]?.aliases).toBeUndefined()
  })
})
