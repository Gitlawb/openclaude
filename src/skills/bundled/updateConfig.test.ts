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

  // @ts-expect-error object possibly undefined
  const blocks = await skill!.getPromptForCommand('', {} as never)
  expect(blocks.length).toBeGreaterThan(0)
  expect(blocks[0]).toMatchObject({ type: 'text' })
  expect((blocks[0] as { text: string }).text).toContain(
    '## Full Settings JSON Schema',
  )
})
