import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []
const originalSimple = process.env.CLAUDE_CODE_SIMPLE
const providerEnvKeys = [
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'NVIDIA_NIM',
  'MINIMAX_API_KEY',
  'XAI_API_KEY',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
] as const
const originalProviderEnv = Object.fromEntries(
  providerEnvKeys.map(key => [key, process.env[key]]),
) as Record<(typeof providerEnvKeys)[number], string | undefined>
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
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-conversation-recovery-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'resume.jsonl')
  await writeFile(filePath, `${JSON.stringify(entry)}\n`)
  return filePath
}

afterEach(async () => {
  mock.restore()
  process.env.CLAUDE_CODE_SIMPLE = originalSimple
  for (const key of providerEnvKeys) {
    const value = originalProviderEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function importFreshConversationRecovery() {
  mock.restore()
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => {
      if (process.env.CLAUDE_CODE_USE_GITHUB) return 'github'
      if (process.env.CLAUDE_CODE_USE_OPENAI) return 'openai'
      if (process.env.CLAUDE_CODE_USE_BEDROCK) return 'bedrock'
      if (process.env.CLAUDE_CODE_USE_VERTEX) return 'vertex'
      if (process.env.CLAUDE_CODE_USE_FOUNDRY) return 'foundry'
      return 'firstParty'
    },
  }))
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./conversationRecovery.ts?conversationRecoveryTest=${nonce}`)
}

function clearProviderEnv(): void {
  for (const key of providerEnvKeys) {
    delete process.env[key]
  }
}

test('loadConversationForResume accepts a small transcript from jsonl path', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'
  const path = await writeJsonl(user(id(1), 'hello'))
  const { loadConversationForResume } = await importFreshConversationRecovery()

  const result = await loadConversationForResume('fixture', path)
  expect(result).not.toBeNull()
  expect(result?.sessionId).toBe(sessionId)
  expect(result?.messages.length).toBeGreaterThan(0)
})

test('loadConversationForResume rejects oversized reconstructed transcripts', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'
  const hugeContent = 'x'.repeat(8 * 1024 * 1024 + 32 * 1024)
  const path = await writeJsonl(user(id(2), hugeContent))
  const {
    loadConversationForResume,
    ResumeTranscriptTooLargeError,
  } = await importFreshConversationRecovery()

  let caught: unknown
  try {
    await loadConversationForResume('fixture', path)
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(ResumeTranscriptTooLargeError)
  expect((caught as Error).message).toContain(
    'Reconstructed transcript is too large to resume safely',
  )
})

test('deserializeMessages preserves thinking blocks for GitHub native Claude transport', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'claude-sonnet-4-6'
  const { deserializeMessages } = await importFreshConversationRecovery()

  const deserialized = deserializeMessages([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'need a plan' },
          { type: 'text', text: 'working on it' },
        ],
      },
    } as any,
  ])

  const content = (deserialized[0] as any)?.message?.content as Array<{
    type: string
  }>
  expect(content.some(block => block.type === 'thinking')).toBe(true)
})
