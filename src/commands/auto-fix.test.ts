import { expect, test } from 'bun:test'

import command from './auto-fix.js'
import type { PromptCommand } from '../types/command.js'

test('auto-fix command has correct metadata', () => {
  expect(command.name).toBe('auto-fix')
  expect(command.type).toBe('prompt')
  expect(command.isEnabled()).toBe(true)
  expect(command.description).toContain('auto-fix')
  if (command.type === 'prompt') {
    expect(command.source).toBe('builtin')
  }
})

test('auto-fix getPromptForCommand returns configuration prompt', async () => {
  if (command.type !== 'prompt') {
    throw new Error('Expected prompt command')
  }

  const prompt = await command.getPromptForCommand('', {} as any)

  expect(Array.isArray(prompt)).toBe(true)
  expect(prompt.length).toBeGreaterThan(0)
  const firstBlock = prompt[0]
  if (firstBlock.type === 'text') {
    expect(firstBlock.text).toContain('auto-fix')
    expect(firstBlock.text).toContain('lint')
    expect(firstBlock.text).toContain('test')
    expect(firstBlock.text).toContain('settings.json')
  }
})

test('auto-fix progress message is set', () => {
  if (command.type !== 'prompt') {
    throw new Error('Expected prompt command')
  }
  expect(command.progressMessage).toBe('Configuring auto-fix...')
})
