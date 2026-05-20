import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import {
  clearCommandMemoizationCaches,
  formatDescriptionWithSource,
  getCommands,
  INTERNAL_ONLY_COMMANDS,
} from './commands.js'
import { isCommand } from './types/command.js'

describe('builtInCommandNames', () => {
  test('includes the LSP command', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-lsp-'))
    try {
      const cmds = await getCommands(cwd)
      expect(cmds.map(c => c.name)).toContain('lsp')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('getCommands() includes bughunter for normal users (USER_TYPE unset)', async () => {
    // Regression: bughunter previously lived in INTERNAL_ONLY_COMMANDS and was
    // never available to non-ant users. Ensure it stays in the public COMMANDS list.
    delete process.env['USER_TYPE']
    delete process.env['IS_DEMO']
    // Clear ALL command caches — including the zero-arg COMMANDS() memoize that
    // captures USER_TYPE at first call and never re-evaluates it. Without this,
    // a prior test that ran with USER_TYPE=ant would pollute the COMMANDS cache
    // and make bughunter appear gated even in a "normal user" run.
    clearCommandMemoizationCaches()
    // Use a unique tmp dir to avoid the loadAllCommands memoize cache
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-bughunter-'))
    try {
      const cmds = await getCommands(cwd)
      expect(cmds.map(c => c.name)).toContain('bughunter')
      expect(INTERNAL_ONLY_COMMANDS.map(c => c.name)).not.toContain('bughunter')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
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
