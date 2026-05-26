import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalClaudeCodeNewInit = process.env.CLAUDE_CODE_NEW_INIT

async function importInitCommand() {
  return (await import(`./init.ts?ts=${Date.now()}-${Math.random()}`)).default
}

beforeEach(async () => {
  await acquireSharedMutationLock('commands/init.test.ts')
})

afterEach(() => {
  try {
    mock.restore()

    if (originalClaudeCodeNewInit === undefined) {
      delete process.env.CLAUDE_CODE_NEW_INIT
    } else {
      process.env.CLAUDE_CODE_NEW_INIT = originalClaudeCodeNewInit
    }
  } finally {
    releaseSharedMutationLock()
  }
})

test('NEW_INIT prompt preserves existing root CLAUDE.md by default', async () => {
  process.env.CLAUDE_CODE_NEW_INIT = '1'

  mock.module('../projectOnboardingState.js', () => ({
    maybeMarkProjectOnboardingComplete: () => {},
  }))
  mock.module('./initMode.js', () => ({
    isNewInitEnabled: () => true,
  }))

  const command = await importInitCommand()
  const blocks = await command.getPromptForCommand()

  expect(blocks).toHaveLength(1)
  expect(blocks[0]?.type).toBe('text')
  expect(String(blocks[0]?.text)).toContain(
    'checked-in root `CLAUDE.md` and does NOT already have a root `AGENTS.md`',
  )
  expect(String(blocks[0]?.text)).toContain(
    'do NOT silently create a second root instruction file',
  )
  expect(String(blocks[0]?.text)).toContain(
    'update the existing root `CLAUDE.md` in place by default',
  )
})
