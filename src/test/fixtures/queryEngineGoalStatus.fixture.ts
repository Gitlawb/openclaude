import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixtureCwd = mkdtempSync(join(tmpdir(), 'openclaude-query-engine-goal-'))
const originalMacro = (globalThis as Record<string, unknown>).MACRO
const originalNodeEnv = process.env.NODE_ENV
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY

try {
  process.env.NODE_ENV = 'test'
  process.env.ANTHROPIC_API_KEY = 'test-api-key'
  mock.module('src/entrypoints/agentSdkTypes.js', () => ({
    EXIT_REASONS: [],
    HOOK_EVENTS: [],
  }))
  ;(globalThis as Record<string, unknown>).MACRO = {
    BUILD_TIME: '2026-06-08T00:00:00.000Z',
    DISPLAY_VERSION: 'test-version',
    ISSUES_EXPLAINER: '',
    NATIVE_PACKAGE_URL: undefined,
    PACKAGE_URL: '',
    VERSION: 'test-version',
  }

  const { setSessionPersistenceDisabled } = await import(
    '../../bootstrap/state.js'
  )
  const { QueryEngine } = await import('../../QueryEngine.js')
  const { createSystemMessage } = await import('../../utils/messages.js')
  const { getDefaultAppState } = await import(
    '../../state/AppStateStore.js'
  )

  setSessionPersistenceDisabled(true)

  let appState = getDefaultAppState()
  const engine = new QueryEngine({
    cwd: fixtureCwd,
    tools: [],
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({ behavior: 'allow' }),
    getAppState: () => appState,
    setAppState: updater => {
      appState = updater(appState)
    },
    readFileCache: {},
    thinkingConfig: { type: 'disabled' },
    customSystemPrompt: 'test system prompt',
    query: async function* () {
      yield createSystemMessage('Goal achieved: tests pass', 'info')
    },
  } as never)

  const emitted: unknown[] = []
  for await (const message of engine.submitMessage('hello')) {
    emitted.push(message)
  }

  const goalStatusMessage = emitted.find(
    (message): message is {
      type: 'assistant'
      message: { content: Array<{ type: string; text: string }> }
      parent_tool_use_id: null
    } =>
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'assistant' &&
      (message as { message?: { content?: unknown } }).message?.content instanceof
        Array &&
      (message as { message: { content: Array<{ type?: unknown; text?: unknown }> } })
        .message.content[0]?.type === 'text' &&
      (message as { message: { content: Array<{ type?: unknown; text?: unknown }> } })
        .message.content[0]?.text === 'Goal achieved: tests pass',
  )

  assert.ok(goalStatusMessage)
  assert.equal(goalStatusMessage.parent_tool_use_id, null)
} finally {
  mock.restore()
  if (originalMacro === undefined) {
    delete (globalThis as Record<string, unknown>).MACRO
  } else {
    ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
  if (originalAnthropicApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey
  }
  rmSync(fixtureCwd, { recursive: true, force: true })
}
