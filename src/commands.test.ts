import { describe, expect, test } from 'bun:test'
import {
  BRIDGE_SAFE_COMMANDS,
  builtInCommandNames,
  findCommand,
  formatDescriptionWithSource,
  isBridgeSafeCommand,
} from './commands.js'
import update from './commands/update/index.js'

describe('builtInCommandNames', () => {
  test('includes the LSP command', () => {
    expect(builtInCommandNames()).toContain('lsp')
  })
})

describe('/update command registration', () => {
  test('registers update and self-update alias', () => {
    const names = builtInCommandNames()

    expect(names).toContain('update')
    expect(names).toContain('self-update')
  })

  test('marks update as bridge-safe', () => {
    expect(BRIDGE_SAFE_COMMANDS).toContain(update)
    expect(isBridgeSafeCommand(update)).toBe(true)
  })

  test('resolves update by alias', () => {
    expect(findCommand('self-update', [update])).toBe(update)
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
