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
const originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL
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
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-conversation-recovery-hooks-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'resume.jsonl')
  await writeFile(filePath, `${JSON.stringify(entry)}\n`)
  return filePath
}

afterEach(async () => {
  mock.restore()
  process.env.CLAUDE_CODE_SIMPLE = originalSimple
  if (originalOpenAIBaseUrl === undefined) {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl
  }
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

test('deserializeMessagesWithInterruptDetection strips thinking blocks only for OpenAI-compatible providers', async () => {
  const serializedMessages = [
    user(id(10), 'hello'),
    {
      type: 'assistant',
      uuid: id(11),
      parentUuid: id(10),
      timestamp: ts,
      cwd: '/tmp',
      sessionId,
      version: 'test',
      message: {
        id: 'msg_visible_thinking',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret reasoning' },
          { type: 'text', text: 'visible reply' },
        ],
      },
    },
    {
      type: 'assistant',
      uuid: id(12),
      parentUuid: id(11),
      timestamp: ts,
      cwd: '/tmp',
      sessionId,
      version: 'test',
      message: {
        id: 'msg_orphan_thinking',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'only hidden reasoning' }],
      },
    },
    user(id(13), 'follow up'),
  ]

  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => 'openai',
    isOpenAICompatibleProvider: (provider: string) =>
      provider === 'openai' ||
      provider === 'gemini' ||
      provider === 'github' ||
      provider === 'codex',
  }))

  const openaiModule = await import(`./conversationRecovery.ts?provider=openai-${Date.now()}`)
  const thirdParty = openaiModule.deserializeMessagesWithInterruptDetection(serializedMessages as never[])
  const thirdPartyAssistantMessages = thirdParty.messages.filter(
    message => message.type === 'assistant',
  )

  expect(thirdPartyAssistantMessages).toHaveLength(2)
  expect(thirdPartyAssistantMessages[0]?.message?.content).toEqual([
    { type: 'text', text: 'visible reply' },
  ])
  expect(
    JSON.stringify(thirdPartyAssistantMessages.map(message => message.message?.content)),
  ).not.toContain('secret reasoning')
  expect(
    JSON.stringify(thirdPartyAssistantMessages.map(message => message.message?.content)),
  ).not.toContain('only hidden reasoning')

  mock.restore()
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => 'bedrock',
    isOpenAICompatibleProvider: (provider: string) =>
      provider === 'openai' ||
      provider === 'gemini' ||
      provider === 'github' ||
      provider === 'codex',
  }))

  const bedrockModule = await import(`./conversationRecovery.ts?provider=bedrock-${Date.now()}`)
  const anthropicCompatible = bedrockModule.deserializeMessagesWithInterruptDetection(serializedMessages as never[])
  const anthropicAssistantMessages = anthropicCompatible.messages.filter(
    message => message.type === 'assistant',
  )

  expect(anthropicAssistantMessages).toHaveLength(2)
  expect(anthropicAssistantMessages[0]?.message?.content).toEqual([
    { type: 'thinking', thinking: 'secret reasoning' },
    { type: 'text', text: 'visible reply' },
  ])
  expect(
    JSON.stringify(anthropicAssistantMessages.map(message => message.message?.content)),
  ).toContain('secret reasoning')
  expect(
    JSON.stringify(anthropicAssistantMessages.map(message => message.message?.content)),
  ).not.toContain('only hidden reasoning')
})

test('deserializeMessagesWithInterruptDetection preserves DeepSeek tool-call thinking on resume', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'

  const serializedMessages = [
    user(id(20), 'hello'),
    {
      type: 'assistant',
      uuid: id(21),
      parentUuid: id(20),
      timestamp: ts,
      cwd: '/tmp',
      sessionId,
      version: 'test',
      message: {
        id: 'msg_no_tool',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'no tool reasoning' },
          { type: 'text', text: 'visible no-tool reply' },
        ],
      },
    },
    user(id(22), 'use a tool'),
    {
      type: 'assistant',
      uuid: id(23),
      parentUuid: id(22),
      timestamp: ts,
      cwd: '/tmp',
      sessionId,
      version: 'test',
      message: {
        id: 'msg_tool_call',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'tool-call reasoning' },
          { type: 'text', text: 'running a command' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'pwd' },
          },
        ],
      },
    },
    {
      type: 'user',
      uuid: id(24),
      parentUuid: id(23),
      timestamp: ts,
      cwd: '/tmp',
      userType: 'external',
      sessionId,
      version: 'test',
      isSidechain: false,
      isMeta: false,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'workspace',
          },
        ],
      },
    },
    user(id(25), 'follow up'),
  ]

  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => 'openai',
    isOpenAICompatibleProvider: (provider: string) =>
      provider === 'openai' ||
      provider === 'gemini' ||
      provider === 'github' ||
      provider === 'codex',
  }))

  const openaiModule = await import(`./conversationRecovery.ts?provider=deepseek-${Date.now()}`)
  const result = openaiModule.deserializeMessagesWithInterruptDetection(serializedMessages as never[])
  const assistantContent = JSON.stringify(
    result.messages
      .filter(message => message.type === 'assistant')
      .map(message => message.message?.content),
  )

  expect(assistantContent).toContain('tool-call reasoning')
  expect(assistantContent).toContain('running a command')
  expect(assistantContent).not.toContain('no tool reasoning')
})
