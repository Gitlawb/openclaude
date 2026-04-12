import { afterEach, expect, test } from 'bun:test'

import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerLoopSkill } from './loop.js'

afterEach(() => {
  clearBundledSkills()
})

test('bare /loop returns dynamic maintenance instructions', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  expect(skill).toBeDefined()
  expect(skill?.type).toBe('prompt')

  const blocks = await skill!.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — dynamic rescheduling')
  expect(text).toContain('If .claude/loop.md exists, read it and use it.')
  expect(text).toContain('continue any unfinished work from the conversation')
  expect(text).toContain('Set the scheduled prompt to this exact text so the next iteration stays in dynamic mode:')
  expect(text).toContain('/loop')
})

test('prompt-only /loop returns dynamic rescheduling instructions', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand('check the deploy', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — dynamic rescheduling')
  expect(text).toContain('check the deploy')
  expect(text).toContain('choose the next delay dynamically between 1 minute and 1 hour')
  expect(text).toContain('/loop check the deploy')
})

test('interval /loop returns fixed recurring instructions', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand('5m check the deploy', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — fixed recurring interval')
  expect(text).toContain('Requested interval:')
  expect(text).toContain('5m')
  expect(text).toContain('Call CronCreate')
  expect(text).toContain('recurring: true')
  expect(text).toContain('Immediately execute the effective prompt now')
})

test('interval-only /loop becomes fixed maintenance mode', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand('15m', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — fixed recurring interval')
  expect(text).toContain('15m')
  expect(text).toContain('This is a maintenance loop with no explicit prompt.')
  expect(text).toContain('Scheduled maintenance loop iteration.')
})
