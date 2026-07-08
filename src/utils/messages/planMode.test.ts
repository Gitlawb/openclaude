import { expect, test } from 'bun:test'
import {
  getAutoModeInstructions,
  getPlanModeInstructions,
  wrapInSystemReminder,
} from './planMode.js'

test('wrapInSystemReminder wraps content in system-reminder tags', () => {
  expect(wrapInSystemReminder('hello')).toBe(
    '<system-reminder>\nhello\n</system-reminder>',
  )
})

test('sparse plan mode instructions return a meta user reminder', () => {
  const [message] = getPlanModeInstructions({
    reminderType: 'sparse',
    planFilePath: '/tmp/plan.md',
    planExists: false,
  })

  expect(message?.type).toBe('user')
  expect(message?.isMeta).toBe(true)
  expect(String(message?.message.content)).toContain('<system-reminder>')
  expect(String(message?.message.content)).toContain('/tmp/plan.md')
})

test('full plan mode instructions return the complete workflow reminder', () => {
  const [message] = getPlanModeInstructions({
    reminderType: 'full',
    planFilePath: '/tmp/full-plan.md',
    planExists: false,
  })

  expect(message?.type).toBe('user')
  expect(message?.isMeta).toBe(true)
  expect(String(message?.message.content)).toContain('## Plan Workflow')
  expect(String(message?.message.content)).toContain('/tmp/full-plan.md')
})

test('sub-agent plan mode instructions use the sub-agent path', () => {
  const [message] = getPlanModeInstructions({
    reminderType: 'sparse',
    isSubAgent: true,
    planFilePath: '/tmp/sub-agent-plan.md',
    planExists: true,
  })

  expect(message?.type).toBe('user')
  expect(message?.isMeta).toBe(true)
  expect(String(message?.message.content)).toContain(
    "Answer the user's query comprehensively",
  )
  expect(String(message?.message.content)).toContain('/tmp/sub-agent-plan.md')
})

test('auto mode instructions return sparse and full reminders', () => {
  expect(
    String(
      getAutoModeInstructions({ reminderType: 'sparse' })[0]?.message.content,
    ),
  ).toContain('Auto mode still active')
  expect(
    String(getAutoModeInstructions({ reminderType: 'full' })[0]?.message.content),
  ).toContain('Auto Mode Active')
})
