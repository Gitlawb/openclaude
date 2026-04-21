import { expect, test } from 'bun:test'

import command from './version.js'
import type { LocalJSXCommandContext } from '../types/command.js'

(globalThis as { MACRO?: { VERSION?: string; BUILD_TIME?: string } }).MACRO = {
  VERSION: '0.1.8',
  BUILD_TIME: '2024-01-15T10:30:00Z',
}

const mockContext: LocalJSXCommandContext = {
  getAppState: () => ({ mainLoopModel: 'claude-sonnet-4-20250514' } as any),
  setAppState: () => { },
  setMessages: () => { },
  onChangeAPIKey: () => { },
  options: {
    ideInstallationStatus: null,
    theme: 'dark',
  },
} as any

test('version command has correct metadata', () => {
  expect(command.name).toBe('version')
  expect(command.type).toBe('local')
  expect(command.supportsNonInteractive).toBe(true)
  expect(command.description).toContain('version')
})

test('version call returns version with build time', async () => {
  const loaded = await command.load()
  const result = await loaded.call('', mockContext)

  expect(result.type).toBe('text')
  if (result.type === 'text') {
    expect(result.value).toContain('0.1.8')
    expect(result.value).toContain('built')
  }
})

test('version call returns version without build time when BUILD_TIME is undefined', async () => {
  ; (globalThis as { MACRO?: { VERSION?: string; BUILD_TIME?: string } }).MACRO = {
    VERSION: '0.1.8',
  }

  const loaded = await command.load()
  const result = await loaded.call('', mockContext)

  expect(result.type).toBe('text')
  if (result.type === 'text') {
    expect(result.value).toBe('0.1.8')
  }
})
