/**
 * Hook-side-effect regression lives in a separate file with no static import of
 * conversationRecovery so Bun's mock.module can replace sessionStart before
 * that module is first loaded.
 */
import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []
const originalSimple = process.env.CLAUDE_CODE_SIMPLE
const sessionId = '00000000-0000-4000-8000-000000001999'
const ts = '2026-04-02T00:00:00.000Z'

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function user(uuid: string, content: string) {
  return {
    type: 'user',
    uuid,
    parentUuid: null,
    timestamp: ts,
    cwd: '/tmp',
    userType: 'external',
    sessionId,
    version: 'test',
    isSidechain: false,
    isMeta: false,
    message: {
      role: 'user',
      content,
    },
  }
}

async function writeJsonl(entry: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openlawb-conversation-recovery-hooks-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'resume.jsonl')
  await writeFile(filePath, `${JSON.stringify(entry)}\n`)
  return filePath
}

afterEach(async () => {
  mock.restore()
  process.env.CLAUDE_CODE_SIMPLE = originalSimple
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

test('loadConversationForResume rejects oversized transcripts before resume hooks run', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  const hugeContent = 'x'.repeat(8 * 1024 * 1024 + 32 * 1024)
  const path = await writeJsonl(user(id(3), hugeContent))
  const hookSpy = mock(() => Promise.resolve([{ type: 'hook' }]))

  mock.module('./sessionStart.js', () => ({
    processSessionStartHooks: hookSpy,
  }))

  const { loadConversationForResume, ResumeTranscriptTooLargeError } = await import(
    './conversationRecovery.ts'
  )

  await expect(loadConversationForResume('fixture', path)).rejects.toBeInstanceOf(
    ResumeTranscriptTooLargeError,
  )
  expect(hookSpy).not.toHaveBeenCalled()
})
