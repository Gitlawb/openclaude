import { expect, mock, test } from 'bun:test'
import type { AgentDefinition } from './loadAgentsDir.js'
import { runAgent } from './runAgent.js'
import type { ToolUseContext } from '../../Tool.js'

// Track how many times each storage function is called
let metadataWriteCount = 0
let transcriptWriteCount = 0

mock.module('../../utils/sessionStorage.js', () => ({
  writeAgentMetadata: async () => {
    metadataWriteCount++
    throw new Error('Simulated disk error during metadata write')
  },
  recordSidechainTranscript: async () => {
    transcriptWriteCount++
  },
  getAgentMetadataPath: () => '/mock/path',
}))

mock.module('../../query.js', () => ({
  query: async function* () {
    yield {
      type: 'assistant',
      uuid: 'msg-1',
      message: { role: 'assistant', content: 'test' },
    }
    yield {
      reason: 'done',
    }
  },
}))

test('skips transcript write if identity metadata fails to persist', async () => {
  metadataWriteCount = 0
  transcriptWriteCount = 0

  const agentDefinition: AgentDefinition = {
    agentType: 'code-reviewer',
    source: 'built-in',
  } as AgentDefinition

  const toolUseContext = {
    options: {
      mainLoopModel: 'test-model',
      agentDefinitions: { activeAgents: [agentDefinition] },
      tools: [],
    },
    getAppState: () => ({
      toolPermissionContext: { mode: 'default', additionalWorkingDirectories: new Map() },
    }),
    setAppState: () => {},
  } as unknown as ToolUseContext

  const runParams = {
    agentId: 'test-agent' as any,
    agentDefinition,
    prompt: 'review this',
    promptMessages: [{ role: 'user', content: 'review this' }],
    toolUseContext,
    override: {
      abortController: new AbortController(),
    },
    querySource: 'subagent',
    canUseTool: async () => ({ behavior: 'allow' } as any),
    availableTools: [],
    allowedTools: undefined,
  } as any

  const iterator = runAgent(runParams)
  const chunks = []
  for await (const chunk of iterator) {
    chunks.push(chunk)
  }

  // The generator should still produce output despite the storage error
  expect(chunks.length).toBeGreaterThan(0)

  // We should have attempted to write metadata and failed
  expect(metadataWriteCount).toBe(1)

  // The transcript writes should have been skipped to prevent an orphaned transcript
  expect(transcriptWriteCount).toBe(0)
})
