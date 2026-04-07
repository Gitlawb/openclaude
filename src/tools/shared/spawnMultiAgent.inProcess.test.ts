/**
 * Tests for handleSpawnInProcess() atomicity and TOCTOU ordering.
 *
 * Key invariants under test:
 *   1. Team file is NOT written when spawnInProcessTeammate() fails.
 *   2. Team file IS written when spawn succeeds.
 *   3. writeTeamFileAsync() is always called AFTER spawnInProcessTeammate()
 *      (spawn-then-persist ordering, not persist-then-spawn).
 *   4. spawnTeammate() re-throws the spawn error without swallowing it.
 *
 * Strategy: use a real tmpdir for team file I/O (redirected via CLAUDE_CONFIG_DIR)
 * rather than mocking teamHelpers.js.  This avoids cross-worker module mock bleed
 * while still letting us assert on the actual file contents.  Only the
 * in-process spawn/runner modules and their heavy infrastructure are stubbed.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ─── Shared state ───────────────────────────────────────────────────────────

let tmpDir = ''
let spawnShouldSucceed = true

/** File state captured inside the spawn mock — used for TOCTOU assertions. */
let teamFileAtSpawnTime: { members: Array<{ name: string }> } | null = null

const mockSpawnInProcessTeammate = mock(
  async (config: { name: string; teamName: string }) => {
    // Snapshot the team file AT THE MOMENT spawn is called.
    // Under the old (broken) ordering the new member would already be present;
    // under the fixed ordering it must NOT be present yet.
    const configPath = join(tmpDir, 'teams', config.teamName, 'config.json')
    try {
      const raw = await readFile(configPath, 'utf-8')
      teamFileAtSpawnTime = JSON.parse(raw) as { members: Array<{ name: string }> }
    } catch {
      teamFileAtSpawnTime = null
    }

    if (!spawnShouldSucceed) {
      return {
        success: false,
        agentId: `${config.name}@${config.teamName}`,
        error: 'mock spawn failure',
      }
    }
    return {
      success: true,
      agentId: `${config.name}@${config.teamName}`,
      taskId: 'task-001',
      abortController: new AbortController(),
      teammateContext: { parentSessionId: 'parent-session-id' },
    }
  },
)

const mockStartInProcessTeammate = mock((_opts: unknown) => {
  /* fire-and-forget stub */
})

// ─── Module mocks ───────────────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'openclaude-spawn-test-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  spawnShouldSucceed = true
  teamFileAtSpawnTime = null
  mockSpawnInProcessTeammate.mockClear()
  mockStartInProcessTeammate.mockClear()

  mock.module('../../utils/swarm/backends/registry.js', () => ({
    isInProcessEnabled: () => true,
    detectAndGetBackend: async () => ({}),
    getBackendByType: () => ({}),
    markInProcessFallback: () => {},
    resetBackendDetection: () => {},
  }))

  mock.module('../../utils/swarm/spawnInProcess.js', () => ({
    spawnInProcessTeammate: mockSpawnInProcessTeammate,
  }))

  mock.module('../../utils/swarm/inProcessRunner.js', () => ({
    startInProcessTeammate: mockStartInProcessTeammate,
  }))

  mock.module('../../utils/cwd.js', () => ({
    getCwd: () => '/tmp',
  }))

  mock.module('../../utils/config.js', () => ({
    getGlobalConfig: () => ({ teammateDefaultModel: undefined }),
  }))

  mock.module('../../utils/swarm/teammateLayoutManager.js', () => ({
    assignTeammateColor: (_id: string) => '#ff0000',
    createTeammatePaneInSwarmView: async () => 'pane-1',
    enablePaneBorderStatus: async () => {},
    sendCommandToPane: async () => {},
    isInsideTmux: async () => false,
  }))

  mock.module('../../utils/swarm/backends/teammateModeSnapshot.js', () => ({
    getTeammateModeFromSnapshot: () => 'auto',
  }))

  mock.module('../../utils/swarm/teammateModel.js', () => ({
    getHardcodedTeammateModelFallback: () => 'claude-sonnet-4-6',
  }))

  mock.module('../../utils/model/model.js', () => ({
    parseUserSpecifiedModel: (m: string) => m,
  }))

  mock.module('../../utils/debug.js', () => ({
    logForDebugging: () => {},
  }))

  mock.module('../../utils/swarm/backends/detection.js', () => ({
    isTmuxAvailable: async () => false,
    isInsideTmux: async () => false,
  }))

  mock.module('../../utils/bundledMode.js', () => ({
    isInBundledMode: () => false,
  }))

  mock.module('react', () => ({
    default: { createElement: () => null },
    createElement: () => null,
  }))

  mock.module('../../Task.js', () => ({
    createTaskStateBase: (_id: string, _type: string, desc: string) => ({
      id: _id,
      type: _type,
      description: desc,
      status: 'running',
    }),
    generateTaskId: (_type: string) =>
      `task-${Math.random().toString(36).slice(2)}`,
  }))

  mock.module('../../utils/agentId.js', () => ({
    formatAgentId: (name: string, team: string) => `${name}@${team}`,
    parseAgentId: (id: string) => {
      const [agentName, teamName] = id.split('@')
      return { agentName, teamName }
    },
  }))

  mock.module('../../utils/bash/shellQuote.js', () => ({
    quote: (s: string) => `'${s}'`,
  }))

  // errors.js is pure helpers — use the real implementation

  mock.module('../../utils/execFileNoThrow.js', () => ({
    execFileNoThrow: async () => ({ code: 0, stdout: '', stderr: '' }),
    execFileNoThrowWithCwd: async () => ({ code: 0, stdout: '', stderr: '' }),
  }))

  mock.module('../../utils/swarm/backends/types.js', () => ({
    isPaneBackend: (_type: string) => false,
  }))

  mock.module('../../utils/swarm/constants.js', () => ({
    SWARM_SESSION_NAME: 'claude-swarm',
    TEAM_LEAD_NAME: 'team-lead',
    TEAMMATE_COMMAND_ENV_VAR: 'CLAUDE_TEAMMATE_COMMAND',
    TMUX_COMMAND: 'tmux',
  }))

  mock.module('../../utils/swarm/It2SetupPrompt.js', () => ({
    It2SetupPrompt: () => null,
  }))

  mock.module('../../utils/swarm/spawnUtils.js', () => ({
    buildInheritedEnvVars: () => ({}),
  }))

  mock.module('../../utils/task/framework.js', () => ({
    registerTask: () => {},
    evictTerminalTask: () => {},
    STOPPED_DISPLAY_MS: 3000,
  }))

  mock.module('../../utils/teammateMailbox.js', () => ({
    writeToMailbox: async () => {},
  }))

  mock.module('../AgentTool/loadAgentsDir.js', () => ({
    isCustomAgent: () => false,
  }))
})

afterEach(async () => {
  mock.restore()
  delete process.env.CLAUDE_CONFIG_DIR
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
})

afterAll(() => {
  mock.restore()
})

// ─── Minimal ToolUseContext stub ────────────────────────────────────────────

function makeContext(teamName = 'test-team') {
  const state = {
    teamContext: { teamName, teamFilePath: '', leadAgentId: '', teammates: {} },
    tasks: {},
    mainLoopModel: 'claude-sonnet-4-6',
  }
  return {
    setAppState: (updater: (s: unknown) => unknown) => {
      Object.assign(state, updater(state))
    },
    getAppState: () => state,
    toolUseId: 'tool-use-001',
    options: { agentDefinitions: { activeAgents: [] } },
    messages: [],
  } as unknown as import('../../Tool.js').ToolUseContext
}

type TeamMember = { name: string; backendType?: string }

async function readTeamFile(
  teamName: string,
): Promise<{ members: Array<TeamMember> } | null> {
  try {
    const raw = await readFile(
      join(tmpDir, 'teams', teamName, 'config.json'),
      'utf-8',
    )
    return JSON.parse(raw) as { members: Array<{ name: string }> }
  } catch {
    return null
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('handleSpawnInProcess – team file atomicity', () => {
  it('does NOT persist the new member to the team file when spawn fails', async () => {
    spawnShouldSucceed = false
    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await expect(
      spawnTeammate(
        { name: 'researcher', prompt: 'do some research', team_name: 'test-team' },
        makeContext(),
      ),
    ).rejects.toThrow('mock spawn failure')

    const file = await readTeamFile('test-team')
    const hasGhost = file?.members.some(m => m.name === 'researcher') ?? false
    expect(hasGhost).toBe(false)
  })

  it('persists the new member after spawn succeeds', async () => {
    spawnShouldSucceed = true
    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await spawnTeammate(
      { name: 'coder', prompt: 'write some code', team_name: 'test-team' },
      makeContext(),
    )

    const file = await readTeamFile('test-team')
    expect(file?.members.some(m => m.name === 'coder')).toBe(true)
  })

  it('new member is NOT in team file at the moment spawnInProcessTeammate is called (no TOCTOU)', async () => {
    spawnShouldSucceed = true
    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await spawnTeammate(
      { name: 'tester', prompt: 'run the tests', team_name: 'test-team' },
      makeContext(),
    )

    // teamFileAtSpawnTime was captured inside the mock at the instant spawn was called.
    // If the file write happened before spawn (the old bug) the member would already
    // be present.  Under the fixed code the member must NOT be there yet.
    const hadMemberBeforeSpawn =
      teamFileAtSpawnTime?.members.some(m => m.name === 'tester') ?? false
    expect(hadMemberBeforeSpawn).toBe(false)
  })

  it('re-throws the spawn error message verbatim', async () => {
    spawnShouldSucceed = false
    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await expect(
      spawnTeammate(
        { name: 'analyst', prompt: 'analyse the logs', team_name: 'test-team' },
        makeContext(),
      ),
    ).rejects.toThrow('mock spawn failure')
  })

  it('does not start the agent execution loop when spawn fails', async () => {
    spawnShouldSucceed = false
    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await expect(
      spawnTeammate(
        { name: 'runner', prompt: 'run the build', team_name: 'test-team' },
        makeContext(),
      ),
    ).rejects.toThrow()

    expect(mockStartInProcessTeammate).not.toHaveBeenCalled()
  })

  it('team file contains the new member with correct name and backendType after success', async () => {
    spawnShouldSucceed = true
    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await spawnTeammate(
      { name: 'reviewer', prompt: 'review the PR', team_name: 'test-team' },
      makeContext(),
    )

    const file = await readTeamFile('test-team')
    const member = file?.members.find(m => m.name === 'reviewer')
    expect(member).toBeDefined()
    expect(member?.backendType).toBe('in-process')
  })

  it('leaves no trace in the team file across two consecutive failed spawns', async () => {
    spawnShouldSucceed = false
    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    for (const name of ['alpha', 'beta']) {
      await expect(
        spawnTeammate(
          { name, prompt: 'do work', team_name: 'test-team' },
          makeContext(),
        ),
      ).rejects.toThrow()
    }

    const file = await readTeamFile('test-team')
    const nonLeadMembers =
      file?.members.filter(m => m.name !== 'team-lead') ?? []
    expect(nonLeadMembers).toHaveLength(0)
  })

  it('propagates a writeTeamFileAsync I/O error after spawn succeeds', async () => {
    // Simulate a disk-full / permission error on the file write that follows a
    // successful spawn.  The spawn task is already registered in AppState at this
    // point — we just want to confirm the error surfaces to the caller rather
    // than being swallowed, so the caller knows the member is not persisted.
    spawnShouldSucceed = true

    // Make the teams dir a FILE so writeTeamFileAsync cannot mkdir inside it.
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const teamsDir = join(tmpDir, 'teams')
    mkdirSync(teamsDir, { recursive: true })
    // Lay a regular file at the path mkdir would need to create the team subdir.
    writeFileSync(join(teamsDir, 'test-team'), 'blocker')

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await expect(
      spawnTeammate(
        { name: 'canary', prompt: 'test write failure', team_name: 'test-team' },
        makeContext(),
      ),
    ).rejects.toThrow()

    // The file should still not contain 'canary' as a proper persisted member.
    const file = await readTeamFile('test-team')
    const hasGhost = file?.members.some(m => m.name === 'canary') ?? false
    expect(hasGhost).toBe(false)
  })
})
