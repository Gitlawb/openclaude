import { expect, test } from 'bun:test'

import type { Key } from '../../ink.js'
import {
  canAcceptPromptSuggestion,
  isNonSpacePrintable,
  resolveCoalescedModeSubmission,
} from './utils.js'

const unmodifiedKey = {} as Key

test('classifies ordinary non-space text as printable', () => {
  expect(isNonSpacePrintable('a', unmodifiedKey)).toBe(true)
})

test('does not classify leading whitespace as printable', () => {
  expect(isNonSpacePrintable(' a', unmodifiedKey)).toBe(false)
})

test('does not classify DEL-coalesced replacement text as printable', () => {
  expect(isNonSpacePrintable('\x7fă', unmodifiedKey)).toBe(false)
})

test('resolves a coalesced mode submission independently of stale rendered mode', () => {
  expect(
    resolveCoalescedModeSubmission('\tignored', 'prompt', {
      mode: 'bash',
      strippedValue: '\tfoo',
    }),
  ).toEqual({
    input: '    foo',
    mode: 'bash',
    inputModeOverride: 'bash',
  })
})

test('only prompt submissions can accept prompt suggestions', () => {
  expect(canAcceptPromptSuggestion('prompt')).toBe(true)
  expect(canAcceptPromptSuggestion('bash')).toBe(false)
})
