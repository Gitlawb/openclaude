import type { AssistantMessage } from '../types/message.js'
import type {
  ToolPermissionContext,
  ToolUseContext,
  Tools,
} from '../Tool.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { getDefaultAppState, type AppState } from '../state/AppStateStore.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../utils/fileStateCache.js'

export const assistantMessage: AssistantMessage = {
  type: 'assistant',
  uuid: 'assistant-uuid',
  message: {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: [],
    model: 'test-model',
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  },
}

export function makePermissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    ...overrides,
  }
}

export function makeAppStateWithPermissionContext(
  toolPermissionContext: ToolPermissionContext,
): AppState {
  return {
    ...getDefaultAppState(),
    toolPermissionContext,
  }
}

// Minimal ToolUseContext for permission checks; it is not a full execution harness.
export function makeToolUseContext(
  appState: AppState,
  tools: Tools = [],
): ToolUseContext {
  let state = appState

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    ),
    messages: [],
    getAppState: () => state,
    setAppState: updater => {
      state = updater(state)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
}
