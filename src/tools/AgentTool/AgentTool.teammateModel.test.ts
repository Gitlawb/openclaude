import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import type { AgentDefinition } from './loadAgentsDir.js'

type ModelAllowlistModule = typeof import('../../utils/model/modelAllowlist.js')
type SettingsModule = typeof import('../../utils/settings/settings.js')
type SpawnMultiAgentModule = typeof import('../shared/spawnMultiAgent.js')
type AgentSwarmsEnabledModule =
  typeof import('../../utils/agentSwarmsEnabled.js')
type SpawnTeammateConfig = Parameters<SpawnMultiAgentModule['spawnTeammate']>[0]

let originalModelAllowlistModule: ModelAllowlistModule | undefined
let originalSettingsModule: SettingsModule | undefined
let originalSpawnMultiAgentModule: SpawnMultiAgentModule | undefined
let originalAgentSwarmsEnabledModule: AgentSwarmsEnabledModule | undefined
let settingsForTest: SettingsJson = {}
let allowedModelsForTest = new Set(['allowed-model'])

const originalEnv = {
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS,
  CLAUDE_CODE_SUBAGENT_MODEL: process.env.CLAUDE_CODE_SUBAGENT_MODEL,
}

beforeEach(async () => {
  await acquireSharedMutationLock(
    'tools/AgentTool/AgentTool.teammateModel.test.ts',
  )
  process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
  delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  settingsForTest = {}
  allowedModelsForTest = new Set(['allowed-model'])
})

afterEach(async () => {
  try {
    mock.restore()
    if (originalModelAllowlistModule) {
      mock.module(
        '../../utils/model/modelAllowlist.js',
        () => originalModelAllowlistModule!,
      )
    }
    if (originalSettingsModule) {
      mock.module('../../utils/settings/settings.js', () => originalSettingsModule!)
    }
    if (originalSpawnMultiAgentModule) {
      mock.module(
        '../shared/spawnMultiAgent.js',
        () => originalSpawnMultiAgentModule!,
      )
    }
    if (originalAgentSwarmsEnabledModule) {
      mock.module(
        '../../utils/agentSwarmsEnabled.js',
        () => originalAgentSwarmsEnabledModule!,
      )
    }
    restoreEnv('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')
    restoreEnv('CLAUDE_CODE_SUBAGENT_MODEL')
    settingsForTest = {}
    allowedModelsForTest = new Set(['allowed-model'])
  } finally {
    releaseSharedMutationLock()
  }
})

function restoreEnv(key: keyof typeof originalEnv): void {
  const originalValue = originalEnv[key]
  if (originalValue === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = originalValue
  }
}

async function importActualModelAllowlist(): Promise<ModelAllowlistModule> {
  return import(
    `../../utils/model/modelAllowlist.ts?agentToolActual=${Date.now()}-${Math.random()}`
  )
}

async function importActualSettings(): Promise<SettingsModule> {
  return import(
    `../../utils/settings/settings.ts?agentToolActual=${Date.now()}-${Math.random()}`
  )
}

async function importActualSpawnMultiAgent(): Promise<SpawnMultiAgentModule> {
  return import(
    `../shared/spawnMultiAgent.ts?agentToolActual=${Date.now()}-${Math.random()}`
  )
}

async function importActualAgentSwarmsEnabled(): Promise<AgentSwarmsEnabledModule> {
  return import(
    `../../utils/agentSwarmsEnabled.ts?agentToolActual=${Date.now()}-${Math.random()}`
  )
}

async function importAgentToolWithSpawnMock(): Promise<{
  AgentTool: typeof import('./AgentTool.js').AgentTool
  spawnTeammate: ReturnType<typeof mock>
}> {
  originalModelAllowlistModule ??= await importActualModelAllowlist()
  originalSettingsModule ??= await importActualSettings()
  originalSpawnMultiAgentModule ??= await importActualSpawnMultiAgent()
  originalAgentSwarmsEnabledModule ??= await importActualAgentSwarmsEnabled()
  const spawnTeammate = mock(async () => ({
    data: {
      teammate_id: 'teammate-1',
      agent_id: 'agent-1',
      team_name: 'review-team',
      name: 'worker-a',
    },
  }))

  mock.module('../../utils/model/modelAllowlist.js', () => ({
    ...originalModelAllowlistModule!,
    isModelAllowed: (model: string) => allowedModelsForTest.has(model.trim()),
  }))
  mock.module('../../utils/settings/settings.js', () => ({
    ...originalSettingsModule!,
    getInitialSettings: () => settingsForTest,
    getSettings_DEPRECATED: () => settingsForTest,
  }))
  mock.module('../shared/spawnMultiAgent.js', () => ({
    ...originalSpawnMultiAgentModule!,
    spawnTeammate,
  }))
  mock.module('../../utils/agentSwarmsEnabled.js', () => ({
    ...originalAgentSwarmsEnabledModule!,
    isAgentSwarmsEnabled: () => true,
  }))

  const { AgentTool } = await import(
    `./AgentTool.js?teammateModel=${Date.now()}-${Math.random()}`
  )
  return { AgentTool, spawnTeammate }
}

function makeToolUseContext(options: {
  mainLoopModel?: string
  activeAgents?: AgentDefinition[]
} = {}): ToolUseContext {
  const appState = {
    toolPermissionContext: { mode: 'default' },
    teamContext: { teamName: 'review-team' },
  }

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: options.mainLoopModel ?? 'allowed-model',
      tools: [],
      verbose: false,
      thinkingConfig: {},
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: {
        activeAgents: options.activeAgents ?? [],
        allAgents: options.activeAgents ?? [],
      },
    },
    abortController: new AbortController(),
    readFileState: {},
    messages: [],
    getAppState: () => appState,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}

function getSpawnConfig(
  spawnTeammate: ReturnType<typeof mock>,
): SpawnTeammateConfig {
  expect(spawnTeammate).toHaveBeenCalledTimes(1)
  return spawnTeammate.mock.calls[0]![0] as SpawnTeammateConfig
}

function createAgentDefinition(
  agentType: string,
  model?: string,
): AgentDefinition {
  return {
    agentType,
    color: 'blue',
    source: 'projectSettings',
    whenToUse: 'review code',
    ...(model && { model }),
    getSystemPrompt: () => 'review code',
  } as unknown as AgentDefinition
}

function callTeammateAgentTool(
  AgentTool: typeof import('./AgentTool.js').AgentTool,
  input: {
    model?: string
    subagent_type?: string
  } = {},
  contextOptions: {
    mainLoopModel?: string
    activeAgents?: AgentDefinition[]
  } = {},
): ReturnType<typeof AgentTool.call> {
  return AgentTool.call(
    {
      description: 'review',
      prompt: 'check the branch',
      team_name: 'review-team',
      name: 'worker-a',
      ...input,
    },
    makeToolUseContext(contextOptions),
    mock(async () => ({ behavior: 'allow' })) as never,
    { requestId: 'req-1' } as never,
  )
}

test('rejects a disallowed custom model before spawning a teammate', async () => {
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await expect(
    callTeammateAgentTool(AgentTool, { model: 'forbidden-model' }),
  ).rejects.toThrow(
    "Model 'forbidden-model' is not available. Your organization restricts model selection.",
  )
  expect(spawnTeammate).not.toHaveBeenCalled()
})

test('trims an allowed custom model before spawning a teammate', async () => {
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(AgentTool, { model: '  allowed-model  ' })

  expect(getSpawnConfig(spawnTeammate).model).toBe('allowed-model')
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(true)
})

test('resolves inherit before spawning a teammate', async () => {
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(
    AgentTool,
    { model: ' InHerit ' },
    { mainLoopModel: 'allowed-model' },
  )

  expect(getSpawnConfig(spawnTeammate).model).toBe('allowed-model')
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(true)
})

test('leaves teammate default selection to spawn layer without a model override', async () => {
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(AgentTool)

  expect(getSpawnConfig(spawnTeammate).model).toBeUndefined()
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(false)
})

test('marks agent definition model fallbacks as non-tool-specified', async () => {
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()
  const activeAgents = [createAgentDefinition('reviewer', 'allowed-model')]

  await callTeammateAgentTool(
    AgentTool,
    { subagent_type: 'reviewer' },
    { activeAgents },
  )

  expect(getSpawnConfig(spawnTeammate).model).toBe('allowed-model')
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(false)
})

test('passes routed agentModels keys to teammate spawns by subagent type', async () => {
  settingsForTest = {
    agentModels: {
      'deepseek-grunt': {
        base_url: 'https://api.deepseek.com/v1',
        api_key: 'sk-ds',
      },
    },
    agentRouting: {
      'general-purpose': 'deepseek-grunt',
    },
  } as unknown as SettingsJson
  allowedModelsForTest = new Set(['deepseek-grunt'])
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(
    AgentTool,
    { subagent_type: 'general-purpose' },
    { activeAgents: [createAgentDefinition('general-purpose')] },
  )

  expect(getSpawnConfig(spawnTeammate).model).toBe('deepseek-grunt')
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(false)
})

test('uses default agentRouting only when no explicit teammate model is provided', async () => {
  settingsForTest = {
    agentModels: {
      'gpt-worker': {
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-oai',
      },
    },
    agentRouting: {
      default: 'gpt-worker',
    },
  } as unknown as SettingsJson
  allowedModelsForTest = new Set(['gpt-worker'])
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(
    AgentTool,
    { subagent_type: 'unknown-worker' },
    { activeAgents: [createAgentDefinition('unknown-worker')] },
  )

  expect(getSpawnConfig(spawnTeammate).model).toBe('gpt-worker')
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(false)
})

test('falls back to a configured agent definition model key after routing misses', async () => {
  settingsForTest = {
    agentModels: {
      'deepseek-grunt': {
        base_url: 'https://api.deepseek.com/v1',
        api_key: 'sk-ds',
      },
    },
    agentRouting: {},
  } as unknown as SettingsJson
  allowedModelsForTest = new Set(['deepseek-grunt'])
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(
    AgentTool,
    { subagent_type: 'reviewer' },
    { activeAgents: [createAgentDefinition('reviewer', 'deepseek-grunt')] },
  )

  expect(getSpawnConfig(spawnTeammate).model).toBe('deepseek-grunt')
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(false)
})

test('does not let non-configured explicit teammate models fall through to default routing', async () => {
  settingsForTest = {
    agentModels: {
      'deepseek-grunt': {
        base_url: 'https://api.deepseek.com/v1',
        api_key: 'sk-ds',
      },
    },
    agentRouting: {
      default: 'deepseek-grunt',
    },
  } as unknown as SettingsJson
  allowedModelsForTest = new Set(['custom-provider-model'])
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(
    AgentTool,
    {
      model: 'custom-provider-model',
      subagent_type: 'general-purpose',
    },
    { activeAgents: [createAgentDefinition('general-purpose')] },
  )

  expect(getSpawnConfig(spawnTeammate).model).toBe('custom-provider-model')
  expect(getSpawnConfig(spawnTeammate).modelWasToolSpecified).toBe(true)
})

test('rejects disallowed routed provider models before spawning a teammate', async () => {
  settingsForTest = {
    agentModels: {
      'deepseek-grunt': {
        base_url: 'https://api.deepseek.com/v1',
        api_key: 'sk-ds',
      },
    },
    agentRouting: {
      'general-purpose': 'deepseek-grunt',
    },
  } as unknown as SettingsJson
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await expect(
    callTeammateAgentTool(
      AgentTool,
      { subagent_type: 'general-purpose' },
      { activeAgents: [createAgentDefinition('general-purpose')] },
    ),
  ).rejects.toThrow(
    "Model 'deepseek-grunt' is not available. Your organization restricts model selection.",
  )
  expect(spawnTeammate).not.toHaveBeenCalled()
})
