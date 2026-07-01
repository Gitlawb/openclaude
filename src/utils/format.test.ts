import { expect, test } from 'bun:test'
import { formatDuration, formatFileSize } from './format.js'

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

// Regression: the sub-second branch gated on `ms < 1` instead of `ms < 1000`,
// so every 1–999ms duration fell through to Math.floor(ms/1000) === 0 and
// rendered "0s" — despite the comment/example promising "0.5s". This showed up
// as `/cost` printing "Total duration (API): 0s" for a fast/cached turn.
test('formats sub-second durations with one decimal place', () => {
  expect(formatDuration(500)).toBe('0.5s')
  expect(formatDuration(100)).toBe('0.1s')
  expect(formatDuration(900)).toBe('0.9s')
})

test('keeps the 0 and whole-second cases intact', () => {
  expect(formatDuration(0)).toBe('0s')
  expect(formatDuration(1000)).toBe('1s')
  expect(formatDuration(1500)).toBe('1s')
  expect(formatDuration(59000)).toBe('59s')
})
