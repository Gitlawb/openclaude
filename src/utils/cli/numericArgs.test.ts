import { expect, test } from 'bun:test'
import { InvalidArgumentError } from '@commander-js/extra-typings'

import {
  parsePositiveAmountArg,
  parsePositiveIntArg,
} from './numericArgs.js'

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

test('rejects integers beyond the safe range', () => {
  // Number.isInteger accepts these, but they no longer round-trip:
  // 9007199254740993 silently parses as 9007199254740992, and 1e308 is a cap
  // the turn loop can never reach.
  expect(() => parsePositiveIntArg('--max-turns', '9007199254740993')).toThrow(
    InvalidArgumentError,
  )
  expect(() => parsePositiveIntArg('--max-turns', '1e308')).toThrow(
    InvalidArgumentError,
  )
  // The boundary itself is still accepted.
  expect(parsePositiveIntArg('--max-turns', '9007199254740991')).toBe(
    Number.MAX_SAFE_INTEGER,
  )
})

test('names the option in the error message', () => {
  expect(() => parsePositiveIntArg('--max-turns', 'abc')).toThrow(
    '--max-turns must be a positive integer',
  )
})

test('parsePositiveAmountArg accepts positive amounts including decimals', () => {
  expect(parsePositiveAmountArg('--max-budget-usd', '5')).toBe(5)
  expect(parsePositiveAmountArg('--max-budget-usd', '0.25')).toBe(0.25)
})

test('parsePositiveAmountArg rejects non-numeric, zero and negative values', () => {
  for (const bad of ['abc', '', '   ', '0', '-1']) {
    expect(() => parsePositiveAmountArg('--max-budget-usd', bad)).toThrow(
      InvalidArgumentError,
    )
  }
})

test('parsePositiveAmountArg rejects an unbounded budget', () => {
  // Number('Infinity') is not NaN and is greater than zero, so a bare isNaN
  // check would accept it as a spending cap that can never be reached.
  expect(() => parsePositiveAmountArg('--max-budget-usd', 'Infinity')).toThrow(
    InvalidArgumentError,
  )
  expect(() => parsePositiveAmountArg('--max-budget-usd', '1e999')).toThrow(
    InvalidArgumentError,
  )
})

test('parsePositiveAmountArg names the option in the error message', () => {
  expect(() => parsePositiveAmountArg('--max-budget-usd', 'abc')).toThrow(
    '--max-budget-usd must be a positive number greater than 0',
  )
})
