import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { feature } from 'bun:bundle'
import React, { useEffect } from 'react'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import type { Notification } from '../../context/notifications.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import { createRoot } from '../../ink.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import {
  AppStateProvider,
  getDefaultAppState,
  useSetAppState,
} from '../../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { Message } from '../../types/message.js'
import type { EffortValue } from '../../utils/effort.js'
import { renderToString } from '../../utils/staticRender.js'

const actualAutoUpdaterWrapper = await import(
  `../AutoUpdaterWrapper.js?actual=${Date.now()}-${Math.random()}`
)
const EFFORT_ENV_KEY = 'CLAUDE_CODE_EFFORT_LEVEL'
let savedEffortEnv: string | undefined

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

async function waitForFrame(
  getOutput: () => string,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const frame = stripAnsi(extractLastFrame(getOutput()))
    if (predicate(frame)) return frame
    await Bun.sleep(10)
  }
  throw new Error('Timed out waiting for rendered frame')
}

beforeEach(async () => {
  await acquireSharedMutationLock(
    'components/PromptInput/Notifications.effort.test.tsx',
  )
  savedEffortEnv = process.env[EFFORT_ENV_KEY]
  delete process.env[EFFORT_ENV_KEY]
  mock.module('../AutoUpdaterWrapper.js', () => ({
    AutoUpdaterWrapper: () => null,
  }))
})

afterEach(() => {
  try {
    if (savedEffortEnv === undefined) {
      delete process.env[EFFORT_ENV_KEY]
    } else {
      process.env[EFFORT_ENV_KEY] = savedEffortEnv
    }
    mock.module('../AutoUpdaterWrapper.js', () => actualAutoUpdaterWrapper)
  } finally {
    releaseSharedMutationLock()
  }
})

async function renderNotifications({
  effortValue,
  currentNotification = null,
  ideSelection = undefined,
  mcpClients = undefined,
  isBriefOnly = false,
  viewingAgentTaskId = undefined,
}: {
  effortValue: EffortValue | undefined
  currentNotification?: Notification | null
  ideSelection?: IDESelection
  mcpClients?: MCPServerConnection[]
  isBriefOnly?: boolean
  viewingAgentTaskId?: string
}): Promise<string> {
  const { Notifications } = await import(
    `./Notifications.js?ts=${Date.now()}-${Math.random()}`
  )

  return renderToString(
    <AppStateProvider
      initialState={{
        ...getDefaultAppState(),
        mainLoopModelForSession: 'claude-opus-4-8',
        effortValue,
        isBriefOnly,
        viewingAgentTaskId,
        notifications: {
          current: currentNotification,
          queue: [],
        },
      }}
    >
      <Notifications
        apiKeyStatus="valid"
        autoUpdaterResult={{ version: null, status: 'success' }}
        debug={false}
        isAutoUpdating={false}
        verbose={false}
        messages={[] as Message[]}
        onAutoUpdaterResult={() => {}}
        onChangeIsUpdating={() => {}}
        ideSelection={ideSelection}
        mcpClients={mcpClients}
      />
    </AppStateProvider>,
    120,
  )
}

test('renders effort as the stable footer fallback when no notification is active', async () => {
  const output = await renderNotifications({ effortValue: 'medium' })

  expect(output).toContain('medium · /effort')
})

test('updates the mounted effort footer when app state changes', async () => {
  const { Notifications } = await import(
    `./Notifications.js?mounted=${Date.now()}-${Math.random()}`
  )
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  let setAppState: ReturnType<typeof useSetAppState> | undefined

  function AppStateController() {
    const setState = useSetAppState()
    useEffect(() => {
      setAppState = setState
    }, [setState])
    return null
  }

  root.render(
    <AppStateProvider
      initialState={{
        ...getDefaultAppState(),
        mainLoopModelForSession: 'claude-opus-4-8',
        effortValue: 'high',
      }}
    >
      <Notifications
        apiKeyStatus="valid"
        autoUpdaterResult={{ version: null, status: 'success' }}
        debug={false}
        isAutoUpdating={false}
        verbose={false}
        messages={[] as Message[]}
        onAutoUpdaterResult={() => {}}
        onChangeIsUpdating={() => {}}
        ideSelection={undefined}
        mcpClients={undefined}
      />
      <AppStateController />
    </AppStateProvider>,
  )

  try {
    const initialFrame = await waitForFrame(getOutput, frame =>
      frame.includes('high · /effort'),
    )
    expect(initialFrame).toContain('high · /effort')

    setAppState!(state => ({ ...state, effortValue: 'low' }))

    const updatedFrame = await waitForFrame(getOutput, frame =>
      frame.includes('low · /effort'),
    )
    expect(updatedFrame).toContain('low · /effort')
    expect(updatedFrame).not.toContain('high · /effort')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})

test('lets transient notifications temporarily occupy the footer slot', async () => {
  const output = await renderNotifications({
    effortValue: 'medium',
    currentNotification: {
      key: 'other',
      text: 'Other notice',
      priority: 'high',
    },
  })

  expect(output).toContain('Other notice')
  expect(output).not.toContain('medium · /effort')
})

test('ignores empty text notifications when rendering the effort footer fallback', async () => {
  const output = await renderNotifications({
    effortValue: 'medium',
    currentNotification: {
      key: 'empty',
      text: '',
      priority: 'low',
    },
  })

  expect(output).toContain('medium · /effort')
})

test('ignores empty JSX notifications when rendering the effort footer fallback', async () => {
  const output = await renderNotifications({
    effortValue: 'medium',
    currentNotification: {
      key: 'empty-jsx',
      jsx: null,
      priority: 'low',
    },
  })

  expect(output).toContain('medium · /effort')
})

test('preserves IDE selection status before the effort fallback', async () => {
  const output = await renderNotifications({
    effortValue: 'medium',
    ideSelection: {
      lineCount: 0,
      filePath: '/tmp/example.ts',
    },
    mcpClients: [
      {
        name: 'ide',
        type: 'connected',
        capabilities: {},
        config: {
          type: 'sse-ide',
          url: 'http://localhost:1234',
          ideName: 'VS Code',
          scope: 'local',
        },
        client: {},
        cleanup: async () => {},
      } as unknown as MCPServerConnection,
    ],
  })

  expect(output).toContain('In example.ts')
  expect(output).not.toContain('medium · /effort')
})

if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
  test('respects brief footer ownership and teammate view', async () => {
    const briefOutput = await renderNotifications({
      effortValue: 'medium',
      isBriefOnly: true,
    })
    const teammateOutput = await renderNotifications({
      effortValue: 'medium',
      isBriefOnly: true,
      viewingAgentTaskId: 'task-123',
    })

    expect(briefOutput).not.toContain('medium · /effort')
    expect(teammateOutput).toContain('medium · /effort')
  })
}
