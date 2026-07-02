import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'
import { clearCommandMemoizationCaches, getCommands } from '../../commands.js'

test('includes the diagnostics command', async () => {
  clearCommandMemoizationCaches()
  const cwd = await mkdtemp(join(tmpdir(), 'oc-test-diagnostics-'))
  try {
    const commands = await getCommands(cwd)
    const command = commands.find(command => command.name === 'diagnostics')
    expect(command).toBeDefined()
    expect(command?.type).toBe('local')
    if (command?.type !== 'local') {
      throw new Error('Expected diagnostics to be a local command')
    }
    expect(command.supportsNonInteractive).toBe(true)
    const loaded = await command.load()
    expect(typeof loaded.call).toBe('function')
  } finally {
    await rm(cwd, { recursive: true, force: true })
    clearCommandMemoizationCaches()
  }
})

test('includes the diagnostics command in the web catalog', async () => {
  const webCommandsModule = (await import(
    new URL('../../../web/src/data/commands.ts', import.meta.url).href
  )) as {
    commands: Array<{ name: string; description: string; category: string }>
  }

  expect(webCommandsModule.commands).toContainEqual({
    name: 'diagnostics',
    description: 'Show available LSP diagnostics already captured for this session',
    category: 'diagnostics',
  })
})
