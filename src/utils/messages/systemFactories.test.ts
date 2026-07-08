import { expect, test } from 'bun:test'
import {
  createCompactBoundaryMessage,
  createSystemMessage,
  findLastCompactBoundaryIndex,
  getMessagesAfterCompactBoundary,
  isCompactBoundaryMessage,
} from './systemFactories.js'

test('createSystemMessage builds an informational system message', () => {
  const message = createSystemMessage('ready', 'info', 'toolu_1')

  expect(message).toMatchObject({
    type: 'system',
    subtype: 'informational',
    content: 'ready',
    level: 'info',
    toolUseID: 'toolu_1',
  })
})

test('compact boundary helpers find and slice from the latest boundary', () => {
  const first = createSystemMessage('old', 'info')
  const boundary = createCompactBoundaryMessage('manual', 100)
  const last = createSystemMessage('new', 'info')

  expect(isCompactBoundaryMessage(boundary)).toBe(true)
  expect(findLastCompactBoundaryIndex([first, boundary, last])).toBe(1)
  expect(getMessagesAfterCompactBoundary([first, boundary, last])).toEqual([
    boundary,
    last,
  ])
})
