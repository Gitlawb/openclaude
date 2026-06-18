import { afterEach, expect, test } from 'bun:test'

import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerUpdateConfigSkill } from './updateConfig.js'

afterEach(() => {
  clearBundledSkills()
})

test('update-config skill can generate its prompt without JSON Schema conversion errors', async () => {
  registerUpdateConfigSkill()

  const skill = getBundledSkills().find(command => command.name === 'update-config')
  expect(skill).toBeDefined()
  expect(skill?.type).toBe('prompt')
  // getPromptForCommand only exists on the PromptCommand variant; narrow first.
  if (skill?.type !== 'prompt') {
    throw new Error(`expected prompt command, got ${skill?.type}`)
  }

  const blocks = await skill.getPromptForCommand('', {} as never)
  expect(blocks.length).toBeGreaterThan(0)
  expect(blocks[0]).toMatchObject({ type: 'text' })
  expect((blocks[0] as { text: string }).text).toContain(
    '## Full Settings JSON Schema',
  )
  expect((blocks[0] as { text: string }).text).toContain(
    '.openclaude/settings.json',
  )
  expect((blocks[0] as { text: string }).text).toContain(
    '.openclaude/settings.local.json',
  )
  expect((blocks[0] as { text: string }).text).not.toContain(
    '.claude/settings.json',
  )
  expect((blocks[0] as { text: string }).text).not.toContain(
    '.claude/settings.local.json',
  )
})
