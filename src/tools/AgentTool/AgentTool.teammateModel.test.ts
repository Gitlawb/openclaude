import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

type ModelAllowlistModule = typeof import('../../utils/model/modelAllowlist.js')
type SpawnMultiAgentModule = typeof import('../shared/spawnMultiAgent.js')
type SpawnTeammateConfig = Parameters<SpawnMultiAgentModule['spawnTeammate']>[0]

let originalModelAllowlistModule: ModelAllowlistModule | undefined
let originalSpawnMultiAgentModule: SpawnMultiAgentModule | undefined

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
    if (originalSpawnMultiAgentModule) {
      mock.module(
        '../shared/spawnMultiAgent.js',
        () => originalSpawnMultiAgentModule!,
      )
    }
    restoreEnv('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')
    restoreEnv('CLAUDE_CODE_SUBAGENT_MODEL')
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

async function importActualSpawnMultiAgent(): Promise<SpawnMultiAgentModule> {
  return import(
    `../shared/spawnMultiAgent.ts?agentToolActual=${Date.now()}-${Math.random()}`
  )
}

async function importAgentToolWithSpawnMock(): Promise<{
  AgentTool: typeof import('./AgentTool.js').AgentTool
  spawnTeammate: ReturnType<typeof mock>
}> {
  originalModelAllowlistModule ??= await importActualModelAllowlist()
  originalSpawnMultiAgentModule ??= await importActualSpawnMultiAgent()
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
    isModelAllowed: (model: string) =>
      model.trim().toLowerCase() === 'allowed-model',
  }))
  mock.module('../shared/spawnMultiAgent.js', () => ({
    ...originalSpawnMultiAgentModule!,
    spawnTeammate,
  }))

  const { AgentTool } = await import(
    `./AgentTool.js?teammateModel=${Date.now()}-${Math.random()}`
  )
  return { AgentTool, spawnTeammate }
}

function makeToolUseContext(options: {
  mainLoopModel?: string
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
      agentDefinitions: { activeAgents: [], allAgents: [] },
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

function callTeammateAgentTool(
  AgentTool: typeof import('./AgentTool.js').AgentTool,
  input: {
    model?: string
  } = {},
  contextOptions: {
    mainLoopModel?: string
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
})

test('resolves inherit before spawning a teammate', async () => {
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(
    AgentTool,
    { model: ' InHerit ' },
    { mainLoopModel: 'allowed-model' },
  )

  expect(getSpawnConfig(spawnTeammate).model).toBe('allowed-model')
})

test('leaves teammate default selection to spawn layer without a model override', async () => {
  const { AgentTool, spawnTeammate } = await importAgentToolWithSpawnMock()

  await callTeammateAgentTool(AgentTool)

  expect(getSpawnConfig(spawnTeammate).model).toBeUndefined()
})
