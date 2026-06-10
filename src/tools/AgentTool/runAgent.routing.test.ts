import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js'
import { createUserMessage } from '../../utils/messages.js'
import {
  resetSettingsCache,
} from '../../utils/settings/settingsCache.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import type { runAgent as runAgentFn } from './runAgent.js'

type ModelAllowlistModule = typeof import('../../utils/model/modelAllowlist.js')
type SettingsModule = typeof import('../../utils/settings/settings.js')

let actualModelAllowlistModule: ModelAllowlistModule | undefined
let actualSettingsModule: SettingsModule | undefined
let allowedModelsForTest: string[] | undefined
let settingsForTest: SettingsJson = {}

const routedSettings = {
  agentModels: {
    'deepseek-grunt': {
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'sk-test',
    },
  },
  agentRouting: {
    'general-purpose': 'deepseek-grunt',
  },
}

describe('runAgent provider routing', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('tools/AgentTool/runAgent.routing.test.ts')
    resetSettingsCache()
    actualSettingsModule ??= await import(
      `../../utils/settings/settings.ts?runAgentRoutingSettingsActual=${Date.now()}-${Math.random()}`
    )
    settingsForTest = {}
    mock.module('../../utils/settings/settings.js', () => ({
      ...actualSettingsModule!,
      getInitialSettings: () => settingsForTest,
      getSettings_DEPRECATED: () => settingsForTest,
    }))
    actualModelAllowlistModule ??= await import(
      `../../utils/model/modelAllowlist.ts?runAgentRoutingActual=${Date.now()}-${Math.random()}`
    )
    allowedModelsForTest = undefined
    mock.module('../../utils/model/modelAllowlist.js', () => ({
      ...actualModelAllowlistModule!,
      isModelAllowed: (model: string) =>
        allowedModelsForTest === undefined ||
        allowedModelsForTest.includes(model),
    }))
  })

  afterEach(() => {
    mock.restore()
    resetSettingsCache()
    allowedModelsForTest = undefined
    settingsForTest = {}
    if (actualSettingsModule) {
      mock.module('../../utils/settings/settings.js', () => actualSettingsModule!)
    }
    if (actualModelAllowlistModule) {
      mock.module('../../utils/model/modelAllowlist.js', () => actualModelAllowlistModule!)
    }
    releaseSharedMutationLock()
  })

  test('passes configured provider override into the child context', async () => {
    settingsForTest = routedSettings
    const parentContext = createToolUseContext('parent-model')
    const stop = new Error('stop after cache-safe params')
    let capturedContext: ToolUseContext | undefined
    const runAgent = await importRunAgent()

    const generator = runAgent({
      agentDefinition: createAgentDefinition(),
      promptMessages: [createUserMessage({ content: 'inspect this' })],
      toolUseContext: parentContext,
      canUseTool: async () => ({ behavior: 'allow' }),
      isAsync: false,
      querySource: 'agent:builtin:general-purpose',
      availableTools: [],
      onCacheSafeParams: params => {
        capturedContext = params.toolUseContext
        throw stop
      },
    })

    await expect(generator.next()).rejects.toBe(stop)

    expect(capturedContext?.options.mainLoopModel).toBe('deepseek-grunt')
    expect(capturedContext?.options.providerOverride).toEqual({
      model: 'deepseek-grunt',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
    })
    expect(capturedContext?.getAppState().mainLoopModel).toBe('deepseek-grunt')
    expect(capturedContext?.getAppState().mainLoopModelForSession).toBe(
      'deepseek-grunt',
    )
    expect(parentContext.options.mainLoopModel).toBe('parent-model')
    expect(parentContext.options.providerOverride).toBeUndefined()
    expect(parentContext.getAppState().mainLoopModel).toBe('parent-model')
  })

  test('rejects disallowed routed models before building child context', async () => {
    settingsForTest = {
      ...routedSettings,
      availableModels: ['parent-model'],
    }
    allowedModelsForTest = ['parent-model']

    const runAgent = await importRunAgent()
    const generator = runAgent({
      agentDefinition: createAgentDefinition(),
      promptMessages: [createUserMessage({ content: 'inspect this' })],
      toolUseContext: createToolUseContext('parent-model'),
      canUseTool: async () => ({ behavior: 'allow' }),
      isAsync: false,
      querySource: 'agent:builtin:general-purpose',
      availableTools: [],
    })

    await expect(generator.next()).rejects.toThrow(
      "Model 'deepseek-grunt' is not available. Your organization restricts model selection.",
    )
  })

  test('does not recheck non-routed alias resolutions', async () => {
    settingsForTest = {
      ...routedSettings,
      agentRouting: {},
      availableModels: ['haiku'],
    }
    allowedModelsForTest = ['haiku']

    const parentContext = createToolUseContext('parent-model')
    const stop = new Error('stop after cache-safe params')
    let capturedContext: ToolUseContext | undefined
    const runAgent = await importRunAgent()

    const generator = runAgent({
      agentDefinition: createAgentDefinition(),
      promptMessages: [createUserMessage({ content: 'inspect this' })],
      toolUseContext: parentContext,
      canUseTool: async () => ({ behavior: 'allow' }),
      isAsync: false,
      querySource: 'agent:builtin:general-purpose',
      availableTools: [],
      model: 'haiku',
      onCacheSafeParams: params => {
        capturedContext = params.toolUseContext
        throw stop
      },
    })

    await expect(generator.next()).rejects.toBe(stop)
    expect(capturedContext?.options.providerOverride).toBeUndefined()
  })
})

function createAgentDefinition(): AgentDefinition {
  return {
    agentType: 'general-purpose',
    color: 'blue',
    source: 'built-in',
    whenToUse: 'general work',
    getSystemPrompt: () => 'You are a subagent.',
  } as unknown as AgentDefinition
}

async function importRunAgent(): Promise<typeof runAgentFn> {
  const stamp = `${Date.now()}-${Math.random()}`
  const module = await import(`./runAgent.ts?runAgentRouting=${stamp}`)
  return module.runAgent
}

function createToolUseContext(mainLoopModel: string): ToolUseContext {
  const appState = {
    mainLoopModel,
    mainLoopModelForSession: mainLoopModel,
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map<string, string>(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    },
    mcp: {
      clients: [],
      tools: [],
    },
    todos: {},
  }

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel,
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: {
        activeAgents: [],
        allAgents: [],
      },
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    ),
    messages: [],
    getAppState: () => appState,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}
