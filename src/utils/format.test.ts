import { expect, test } from 'bun:test'
import { formatDuration, formatFileSize, formatSecondsShort } from './format.js'

test('formats sub-second durations with one decimal place', () => {
  // Regression: the < 1s branch was guarded by `ms < 1` (1 millisecond), so
  // real sub-second durations rendered as "0s" instead of the documented
  // single-decimal form.
  expect(formatDuration(500)).toBe('0.5s')
  expect(formatDuration(100)).toBe('0.1s')
  expect(formatDuration(900)).toBe('0.9s')
  // 0.999s rounds to one decimal place.
  expect(formatDuration(999)).toBe('1.0s')
  // Halfway cases must round in integer milliseconds, not on the raw fraction:
  // `(950 / 1000).toFixed(1)` yields "0.9" because 0.95 isn't representable in
  // binary floating point, so the decimal is computed from rounded ms instead.
  expect(formatDuration(950)).toBe('1.0s')
  expect(formatDuration(850)).toBe('0.9s')
})

test('formatSecondsShort keeps a stable one-decimal second', () => {
  expect(formatSecondsShort(1234)).toBe('1.2s')
  expect(formatSecondsShort(950)).toBe('1.0s')
  expect(formatSecondsShort(1250)).toBe('1.3s')
})

test('formats whole-second and zero durations without a decimal', () => {
  expect(formatDuration(0)).toBe('0s')
  expect(formatDuration(1000)).toBe('1s')
  expect(formatDuration(1500)).toBe('1s')
})

test('formats multi-unit durations', () => {
  expect(formatDuration(65000)).toBe('1m 5s')
  expect(formatDuration(3661000)).toBe('1h 1m 1s')
})

test('formats sub-KB sizes as raw bytes', () => {
  expect(formatFileSize(0)).toBe('0 bytes')
  expect(formatFileSize(512)).toBe('512 bytes')
  expect(formatFileSize(1023)).toBe('1023 bytes')
})

test('formats KB sizes with a stripped trailing .0', () => {
  expect(formatFileSize(1024)).toBe('1KB')
  expect(formatFileSize(1536)).toBe('1.5KB')
})

test('rolls KB over to MB when the rounded value reaches 1024', () => {
  // 1048575 bytes is 1023.999...KB, which rounds up to 1024.0 — must
  // promote to "1MB" rather than render the impossible "1024KB".
  expect(formatFileSize(1048575)).toBe('1MB')
  expect(formatFileSize(1048576)).toBe('1MB')
})

test('rolls MB over to GB when the rounded value reaches 1024', () => {
  // 1073741823 bytes is 1023.999...MB, which rounds up to 1024.0 — must
  // promote to "1GB" rather than render the impossible "1024MB".
  expect(formatFileSize(1073741823)).toBe('1GB')
  expect(formatFileSize(1073741824)).toBe('1GB')
})

test('formats normal MB and GB sizes', () => {
  expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5MB')
  expect(formatFileSize(1024 * 1024 * 1024 * 3)).toBe('3GB')
})
