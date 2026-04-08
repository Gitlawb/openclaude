import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('NEW_INIT prompt preserves existing root CLAUDE.md by default', () => {
  const source = readFileSync(new URL('./init.ts', import.meta.url), 'utf8')

  expect(source).toContain(
    'checked-in root \\`CLAUDE.md\\` and does NOT already have a root \\`AGENTS.md\\`',
  )
  expect(source).toContain(
    'do NOT silently create a second root instruction file',
  )
  expect(source).toContain(
    'update the existing root \\`CLAUDE.md\\` in place by default',
  )
})
