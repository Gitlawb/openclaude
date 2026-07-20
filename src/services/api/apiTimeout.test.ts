import { afterEach, beforeEach, expect, test } from 'bun:test'

import { parseApiTimeoutMsEnv } from './apiTimeout.js'

let saved: string | undefined

beforeEach(() => {
  saved = process.env.API_TIMEOUT_MS
})

afterEach(() => {
  if (saved === undefined) {
    delete process.env.API_TIMEOUT_MS
  } else {
    process.env.API_TIMEOUT_MS = saved
  }
})

function withValue(value: string | undefined): number | null {
  if (value === undefined) {
    delete process.env.API_TIMEOUT_MS
  } else {
    process.env.API_TIMEOUT_MS = value
  }
  return parseApiTimeoutMsEnv()
}

test('accepts a plain positive duration', () => {
  expect(withValue('600000')).toBe(600000)
  expect(withValue(' 30000 ')).toBe(30000)
})

test('returns null when unset or empty', () => {
  expect(withValue(undefined)).toBeNull()
  expect(withValue('')).toBeNull()
  expect(withValue('   ')).toBeNull()
})

test('rejects values parseInt would silently truncate', () => {
  // The realistic typo: parseInt('30s') is 30, i.e. a 30-millisecond timeout,
  // so every request fails while the error advises increasing the value.
  expect(withValue('30s')).toBeNull()
  expect(withValue('10x')).toBeNull()
  expect(withValue('1_000')).toBeNull()
})

test('rejects values that become NaN or a non-positive delay', () => {
  // NaN and negative delays are both clamped to 0 by the timer, so these would
  // time out immediately rather than fall back to the default.
  expect(withValue('abc')).toBeNull()
  expect(withValue('-5')).toBeNull()
  expect(withValue('0')).toBeNull()
})

test('rejects non-integer and unsafe-integer values', () => {
  expect(withValue('1.5')).toBeNull()
  expect(withValue('1e9')).toBeNull()
  expect(withValue('9007199254740993')).toBeNull()
})
