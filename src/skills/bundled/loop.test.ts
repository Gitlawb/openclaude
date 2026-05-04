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

  const blocks = await skill!.getPromptForCommand!('', {} as never)
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
  const blocks = await skill!.getPromptForCommand!('check the deploy', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — dynamic rescheduling')
  expect(text).toContain('check the deploy')
  expect(text).toContain('choose the next delay dynamically between 1 minute and 1 hour')
  expect(text).toContain('/loop check the deploy')
})

test('interval /loop returns fixed recurring instructions', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand!('5m check the deploy', {} as never)
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
  const blocks = await skill!.getPromptForCommand!('15m', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — fixed recurring interval')
  expect(text).toContain('15m')
  expect(text).toContain('This is a maintenance loop with no explicit prompt.')
  expect(text).toContain('Scheduled maintenance loop iteration.')
})

test('trailing every clause parses interval and prompt', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand!('check the deploy every 20m', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — fixed recurring interval')
  expect(text).toContain('20m')
  expect(text).toContain('check the deploy')
})

test('trailing every clause with word unit parses correctly', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand!('run tests every 5 minutes', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — fixed recurring interval')
  expect(text).toContain('5m')
  expect(text).toContain('run tests')
})

test('"check every PR" is not treated as an interval', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand!('check every PR', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — dynamic rescheduling')
  expect(text).toContain('check every PR')
})

test('human-readable hour unit parses correctly', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand!('2h check logs', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /loop — fixed recurring interval')
  expect(text).toContain('2h')
  expect(text).toContain('check logs')
})

test('prompt delimiters are present and unambiguous', async () => {
  registerLoopSkill()

  const skill = getBundledSkills().find(command => command.name === 'loop')
  const blocks = await skill!.getPromptForCommand!('5m say hi', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('--- BEGIN PROMPT ---')
  expect(text).toContain('say hi')
  expect(text).toContain('--- END PROMPT ---')
})
