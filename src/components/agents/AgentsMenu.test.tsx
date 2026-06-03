import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../../ink.js'
import {
  getDefaultAppState,
  AppStateProvider,
  useSetAppState,
} from '../../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import * as realUseMergedTools from '../../hooks/useMergedTools.js'
import type { ModeState } from './types.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break
    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) lastFrame = frame
    cursor = end + SYNC_END.length
  }

  return lastFrame ?? output
}

function createTestStreams() {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: () => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  return { stdout, stdin, getOutput: () => output }
}

async function waitForOutput(
  getOutput: () => string,
  predicate: (frame: string) => boolean,
): Promise<string> {
  const startedAt = Date.now()
  let frame = ''

  while (Date.now() - startedAt < 2500) {
    frame = stripAnsi(extractLastFrame(getOutput()))
    if (predicate(frame)) return frame
    await Bun.sleep(10)
  }

  throw new Error(`Timed out waiting for agents menu output:\n${frame}`)
}

function createAgent(
  agentType: string,
  source: AgentDefinition['source'] = 'userSettings',
): AgentDefinition {
  return {
    agentType,
    whenToUse: `Use ${agentType}`,
    source,
    getSystemPrompt: () => `You are ${agentType}`,
  }
}

type AgentsMenuComponent = typeof import('./AgentsMenu.js').AgentsMenu

async function importAgentsMenu(): Promise<AgentsMenuComponent> {
  const nonce = `${Date.now()}-${Math.random()}`
  return (await import(`./AgentsMenu.js?agents-menu-test=${nonce}`)).AgentsMenu
}

function AgentsMenuHarness({
  AgentsMenu,
  initialModeState,
  onSetActiveAgent,
}: {
  AgentsMenu: AgentsMenuComponent
  initialModeState: ModeState
  onSetActiveAgent?: (agent: AgentDefinition) => void
}) {
  const setAppState = useSetAppState()

  return (
    <AgentsMenu
      tools={[]}
      onExit={() => {}}
      initialModeState={initialModeState}
      onSetActiveAgent={agent => {
        onSetActiveAgent?.(agent)
        setAppState(state => ({
          ...state,
          agent: agent.agentType,
        }))
      }}
    />
  )
}

beforeEach(async () => {
  await acquireSharedMutationLock('components/agents/AgentsMenu.test.tsx')
  mock.module('../../hooks/useMergedTools.js', () => ({
    ...realUseMergedTools,
    useMergedTools: () => [],
  }))
})

afterEach(() => {
  try {
    mock.restore()
    mock.module('../../hooks/useMergedTools.js', () => realUseMergedTools)
  } finally {
    releaseSharedMutationLock()
  }
})

test('sets a different active session agent from the agent menu', async () => {
  const AgentsMenu = await importAgentsMenu()
  const reviewer = createAgent('reviewer')
  const analyzer = createAgent('analyzer')
  const initialState = {
    ...getDefaultAppState(),
    agent: 'reviewer',
    agentDefinitions: {
      activeAgents: [reviewer, analyzer],
      allAgents: [reviewer, analyzer],
    },
  }
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  let callbackAgent: AgentDefinition | undefined
  let latestAgent = initialState.agent

  root.render(
    <AppStateProvider
      initialState={initialState}
      onChangeAppState={({ newState }) => {
        latestAgent = newState.agent
      }}
    >
      <AgentsMenuHarness
        AgentsMenu={AgentsMenu}
        initialModeState={{
          mode: 'agent-menu',
          agent: analyzer,
          previousMode: { mode: 'list-agents', source: 'all' },
        }}
        onSetActiveAgent={agent => {
          callbackAgent = agent
        }}
      />
    </AppStateProvider>,
  )

  try {
    await waitForOutput(getOutput, frame =>
      frame.includes('Set as active agent'),
    )

    stdin.write('2')

    await waitForOutput(getOutput, frame =>
      frame.includes('Active session agent set to: analyzer'),
    )

    expect(callbackAgent?.agentType).toBe('analyzer')
    expect(latestAgent).toBe('analyzer')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('sets the effective agent definition for a shadowed selected row', async () => {
  const AgentsMenu = await importAgentsMenu()
  const builtInReviewer = createAgent('reviewer', 'built-in')
  const userReviewer = createAgent('reviewer')
  const planner = createAgent('planner')
  const initialState = {
    ...getDefaultAppState(),
    agent: 'planner',
    agentDefinitions: {
      activeAgents: [userReviewer, planner],
      allAgents: [builtInReviewer, userReviewer, planner],
    },
  }
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  let callbackAgent: AgentDefinition | undefined
  let latestAgent = initialState.agent

  root.render(
    <AppStateProvider
      initialState={initialState}
      onChangeAppState={({ newState }) => {
        latestAgent = newState.agent
      }}
    >
      <AgentsMenuHarness
        AgentsMenu={AgentsMenu}
        initialModeState={{
          mode: 'agent-menu',
          agent: builtInReviewer,
          previousMode: { mode: 'list-agents', source: 'all' },
        }}
        onSetActiveAgent={agent => {
          callbackAgent = agent
        }}
      />
    </AppStateProvider>,
  )

  try {
    await waitForOutput(getOutput, frame =>
      frame.includes('Set as active agent'),
    )

    stdin.write('2')

    const output = await waitForOutput(getOutput, frame =>
      frame.includes('Active session agent set to: reviewer'),
    )

    expect(output).toContain('Current session agent: reviewer')
    expect(callbackAgent).toBe(userReviewer)
    expect(latestAgent).toBe('reviewer')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('shows active-agent status instead of duplicate set-active action', async () => {
  const AgentsMenu = await importAgentsMenu()
  const reviewer = createAgent('reviewer')
  const analyzer = createAgent('analyzer')
  const initialState = {
    ...getDefaultAppState(),
    agent: 'reviewer',
    agentDefinitions: {
      activeAgents: [reviewer, analyzer],
      allAgents: [reviewer, analyzer],
    },
  }
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AppStateProvider initialState={initialState}>
      <AgentsMenu
        tools={[]}
        onExit={() => {}}
        initialModeState={{
          mode: 'agent-menu',
          agent: reviewer,
          previousMode: { mode: 'list-agents', source: 'all' },
        }}
      />
    </AppStateProvider>,
  )

  try {
    const output = await waitForOutput(getOutput, frame =>
      frame.includes('Active agent'),
    )

    expect(output).not.toContain('Set as active agent')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('omits set-active action when no session setter is available', async () => {
  const AgentsMenu = await importAgentsMenu()
  const reviewer = createAgent('reviewer')
  const analyzer = createAgent('analyzer')
  const initialState = {
    ...getDefaultAppState(),
    agent: 'reviewer',
    agentDefinitions: {
      activeAgents: [reviewer, analyzer],
      allAgents: [reviewer, analyzer],
    },
  }
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AppStateProvider initialState={initialState}>
      <AgentsMenu
        tools={[]}
        onExit={() => {}}
        initialModeState={{
          mode: 'agent-menu',
          agent: analyzer,
          previousMode: { mode: 'list-agents', source: 'all' },
        }}
      />
    </AppStateProvider>,
  )

  try {
    const output = await waitForOutput(getOutput, frame =>
      frame.includes('View agent'),
    )

    expect(output).not.toContain('Set as active agent')
    expect(output).not.toContain('Active agent')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})
