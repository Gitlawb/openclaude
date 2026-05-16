import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import { getEmptyToolPermissionContext } from './Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from './test/sharedMutationLock.js'

let lspConnected = false
const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const

await acquireSharedMutationLock('tools.lsp.test.ts')

mock.module('./entrypoints/agentSdkTypes.js', () => ({ HOOK_EVENTS }))
mock.module('src/entrypoints/agentSdkTypes.js', () => ({ HOOK_EVENTS }))

mock.module('./services/lsp/manager.js', () => ({
  getInitializationStatus: () => ({ status: 'success' }),
  getLspServerManager: () => undefined,
  initializeLspServerManager: async () => {},
  isLspConnected: () => lspConnected,
  reinitializeLspServerManager: () => {},
  resetLspServerManagerForTesting: () => {},
  shutdownLspServerManager: async () => {},
  waitForInitialization: async () => {},
}))

const { getAllBaseTools, getTools } = await import('./tools.js')

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

beforeEach(() => {
  lspConnected = false
})

test('LSPTool is part of the base tool pool', () => {
  expect(getAllBaseTools().map(tool => tool.name)).toContain('LSP')
})

test('LSPTool is filtered from usable tools until a server is connected', () => {
  const permissionContext = getEmptyToolPermissionContext()

  expect(getTools(permissionContext).map(tool => tool.name)).not.toContain('LSP')

  lspConnected = true

  expect(getTools(permissionContext).map(tool => tool.name)).toContain('LSP')
})
