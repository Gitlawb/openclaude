import { expect, test } from 'bun:test'

import {
  getOpenAIContextWindow,
  getOpenAIMaxOutputTokens,
} from './openaiContextWindows.js'

test('deepseek-v4-pro:cloud caps max output at 65536 (issue #917)', () => {
  expect(getOpenAIMaxOutputTokens('deepseek-v4-pro:cloud')).toBe(65_536)
})

test('deepseek-v4-flash:cloud caps max output at 65536 (issue #917)', () => {
  expect(getOpenAIMaxOutputTokens('deepseek-v4-flash:cloud')).toBe(65_536)
})

test('deepseek-v4-pro (non-cloud) keeps 262144 max output', () => {
  expect(getOpenAIMaxOutputTokens('deepseek-v4-pro')).toBe(262_144)
})

test('deepseek-v4-flash (non-cloud) keeps 262144 max output', () => {
  expect(getOpenAIMaxOutputTokens('deepseek-v4-flash')).toBe(262_144)
})

test('deepseek-v4 :cloud variants advertise 1M context window', () => {
  expect(getOpenAIContextWindow('deepseek-v4-pro:cloud')).toBe(1_048_576)
  expect(getOpenAIContextWindow('deepseek-v4-flash:cloud')).toBe(1_048_576)
})

test('prefix-match still resolves dated variants to base entry', () => {
  // deepseek-v4-pro-2026-04 should fall back to base deepseek-v4-pro
  expect(getOpenAIMaxOutputTokens('deepseek-v4-pro-2026-04')).toBe(262_144)
})
