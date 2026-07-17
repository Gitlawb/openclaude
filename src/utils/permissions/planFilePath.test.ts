import { expect, test } from 'bun:test'
import { join } from 'path'

import { isPlanFilePath } from './filesystem.js'

// isPlanFilePath gates two permission carve-outs in checkEditableInternalPath /
// checkReadableInternalPath: a plan file for the current session is auto-allowed
// for read AND for write with no prompt. The match must be exactly this
// session's plan, not any sibling that shares the slug as a name prefix.
const PLANS = join('/home/user', '.openclaude', 'plans')
const SLUG = 'brave-swift-otter'

test('accepts the main plan file', () => {
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}.md`))).toBe(true)
})

test('accepts an agent plan file', () => {
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}-agent-abc123.md`)),
  ).toBe(true)
})

test('rejects a sibling whose name merely begins with the slug', () => {
  // Before the fix these all passed a bare startsWith({plansDir}/{slug}) check
  // and were silently auto-allowed for read and un-prompted write.
  for (const name of [
    `${SLUG}nova.md`,
    `${SLUG}-other.md`,
    `${SLUG}2.md`,
  ]) {
    expect(isPlanFilePath(PLANS, SLUG, join(PLANS, name))).toBe(false)
  }
})

test('rejects a sibling directory whose name begins with the slug', () => {
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}dir`, 'anything.md')),
  ).toBe(false)
})

test('rejects a different session slug', () => {
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, 'calm-quiet-fox.md'))).toBe(
    false,
  )
})

test('rejects non-.md paths', () => {
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}.txt`))).toBe(false)
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}`))).toBe(false)
})

test('normalizes traversal segments before matching', () => {
  // A path that resolves outside the plans dir must not match.
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, '..', 'evil', `${SLUG}.md`)),
  ).toBe(false)
})
