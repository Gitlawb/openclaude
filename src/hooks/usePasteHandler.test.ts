import { expect, test } from 'bun:test'
import { supportsClipboardImageFallback } from './usePasteHandler.ts'

test('supports clipboard image fallback on Windows', () => {
  expect(supportsClipboardImageFallback('windows')).toBe(true)
})

test('supports clipboard image fallback on macOS', () => {
  expect(supportsClipboardImageFallback('macos')).toBe(true)
})

test('supports clipboard image fallback on Linux', () => {
  expect(supportsClipboardImageFallback('linux')).toBe(true)
})

test('does not support clipboard image fallback on WSL', () => {
  expect(supportsClipboardImageFallback('wsl')).toBe(false)
})

test('does not support clipboard image fallback on unknown platforms', () => {
  expect(supportsClipboardImageFallback('unknown')).toBe(false)
})
