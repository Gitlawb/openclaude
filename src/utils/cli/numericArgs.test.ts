import { expect, test } from 'bun:test'
import { InvalidArgumentError } from '@commander-js/extra-typings'

import { parsePositiveIntArg } from './numericArgs.js'

test('accepts a positive integer', () => {
  expect(parsePositiveIntArg('--max-turns', '3')).toBe(3)
  expect(parsePositiveIntArg('--max-turns', '100')).toBe(100)
})

test('rejects non-numeric input that Number() coerces to NaN', () => {
  // The bug: `.argParser(Number)` turned "abc"/"10x" into NaN, and the cap
  // check `maxTurns && turnCount > maxTurns` is falsy for NaN, so the agent
  // ran with no turn limit at all.
  for (const bad of ['abc', '10x', '', '   ']) {
    expect(() => parsePositiveIntArg('--max-turns', bad)).toThrow(
      InvalidArgumentError,
    )
  }
})

test('rejects zero and negatives', () => {
  // 0 is falsy (unbounded); a negative cap fires on turn 1 (immediate exit).
  expect(() => parsePositiveIntArg('--max-turns', '0')).toThrow(
    InvalidArgumentError,
  )
  expect(() => parsePositiveIntArg('--max-turns', '-5')).toThrow(
    InvalidArgumentError,
  )
})

test('rejects non-integers and Infinity', () => {
  expect(() => parsePositiveIntArg('--max-turns', '2.5')).toThrow(
    InvalidArgumentError,
  )
  expect(() => parsePositiveIntArg('--max-turns', '1e999')).toThrow(
    InvalidArgumentError,
  )
})

test('names the option in the error message', () => {
  expect(() => parsePositiveIntArg('--max-turns', 'abc')).toThrow(
    '--max-turns must be a positive integer',
  )
})
