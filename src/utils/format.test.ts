import { expect, test } from 'bun:test'
import { formatFileSize } from './format.js'

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
