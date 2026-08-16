import { expect, test } from 'bun:test'

import type { Key } from '../../ink.js'
import {
  canAcceptPromptSuggestion,
  isNonSpacePrintable,
  normalizePromptInputChunk,
  resolveHelpToggleChange,
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

test('classifies printable text before a DEL byte as printable', () => {
  expect(isNonSpacePrintable('x\x7fy', unmodifiedKey)).toBe(true)
})

test('normalizes tabs before a DEL-coalesced chunk reaches cursor editing', () => {
  expect(normalizePromptInputChunk('\x7f\tfoo', unmodifiedKey, false)).toBe(
    '\x7f    foo',
  )
})

test('prepends a lazy image-pill space before printable text preceding DEL', () => {
  expect(normalizePromptInputChunk('x\x7fy', unmodifiedKey, true)).toBe(
    ' x\x7fy',
  )
})

test('does not prepend a lazy image-pill space when DEL comes first', () => {
  expect(normalizePromptInputChunk('\x7fy', unmodifiedKey, true)).toBe(
    '\x7fy',
  )
})

test('restores pre-character state and suppresses a coalesced help submission', () => {
  expect(
    resolveHelpToggleChange('?', {
      previousValue: '',
      cursorOffset: 0,
      willSubmit: true,
    }),
  ).toEqual({
    restore: { value: '', cursorOffset: 0 },
    suppressSubmit: true,
  })
})

test('ignores non-help input when resolving special input changes', () => {
  expect(resolveHelpToggleChange('x')).toBeNull()
})

test('does not classify End key input as printable', () => {
  expect(isNonSpacePrintable('a', { end: true } as Key)).toBe(false)
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

test('preserves input and rendered mode without a pending mode entry', () => {
  expect(resolveCoalescedModeSubmission('echo ok', 'bash', null)).toEqual({
    input: 'echo ok',
    mode: 'bash',
  })
})

test('only prompt submissions can accept prompt suggestions', () => {
  expect(canAcceptPromptSuggestion('prompt')).toBe(true)
  expect(canAcceptPromptSuggestion('bash')).toBe(false)
})
