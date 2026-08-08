import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import figures from 'figures'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../../ink.js'
import { AppStateProvider } from '../../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { CurrentAgentRoute } from '../../services/api/agentRouteSettings.js'
import * as realRouteSettings from '../../services/api/agentRouteSettings.js'

const ROUTE_SETTINGS_MODULE = '../../services/api/agentRouteSettings.js'
// Snapshot the real exports before any mock.module call. bun live-updates the
// `realRouteSettings` namespace when the module is mocked, so spreading it
// directly (or restoring from it in afterEach) can pull in the mocked values;
// this frozen copy keeps both the mock spread and the restore pinned to the
// genuine implementation.
const actualRouteSettings = { ...realRouteSettings }

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
  throw new Error(`Timed out waiting for route selector output:\n${frame}`)
}

// Controls for the mocked service I/O, reset per test.
let shadowSource: string | null = null
let setCalls: Array<[string, string]> = []
let clearCalls: string[] = []
let setResult: { error: Error | null } = { error: null }

beforeEach(async () => {
  await acquireSharedMutationLock('components/agents/AgentRouteSelector.test.tsx')
  shadowSource = null
  setCalls = []
  clearCalls = []
  setResult = { error: null }
  // Override only the I/O wrappers the component calls. buildRouteOptions is
  // left as the REAL implementation on purpose: faking it here would persist in
  // bun's module registry (mock.module live-updates the namespace, so the
  // afterEach re-mock re-installs the fake) and leak into agentRouteSettings.test.ts,
  // which unit-tests the real buildRouteOptions. The real one is deterministic:
  // getAgentModelOptions always lists sonnet/opus/haiku first, so option 1 is
  // 'sonnet' regardless of the host's settings.
  mock.module(ROUTE_SETTINGS_MODULE, () => ({
    ...actualRouteSettings,
    getRouteShadowSource: () => shadowSource,
    setAgentRoute: (agentType: string, modelKey: string) => {
      setCalls.push([agentType, modelKey])
      return setResult
    },
    clearAgentRoute: (agentType: string) => {
      clearCalls.push(agentType)
      return { error: null }
    },
  }))
})

afterEach(() => {
  try {
    mock.restore()
    // Re-point the module at the real implementation. bun's mock.module
    // persists across files in the same process, and mock.restore() alone does
    // not undo it, so without this the mocked buildRouteOptions/etc. leak into
    // agentRouteSettings.test.ts and fail its assertions.
    mock.module(ROUTE_SETTINGS_MODULE, () => actualRouteSettings)
  } finally {
    releaseSharedMutationLock()
  }
})

async function importSelector() {
  const nonce = `${Date.now()}-${Math.random()}`
  return (await import(`./AgentRouteSelector.js?route-selector-test=${nonce}`))
    .AgentRouteSelector
}

async function renderSelector(props: {
  agentType: string
  current: CurrentAgentRoute
  onClose: () => void
}) {
  const AgentRouteSelector = await importSelector()
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(
    <AppStateProvider>
      <AgentRouteSelector {...props} />
    </AppStateProvider>,
  )
  return { root, stdin, getOutput }
}

test('shadow mode shows a read-only notice naming the overriding source', async () => {
  shadowSource = 'projectSettings'
  let closed = false
  const { root, stdin, getOutput } = await renderSelector({
    agentType: 'verification',
    current: { kind: 'none' },
    onClose: () => {
      closed = true
    },
  })
  try {
    const frame = await waitForOutput(getOutput, f =>
      f.includes('override your user settings'),
    )
    expect(frame).toContain('verification')
    expect(frame).toContain('projectSettings')
    expect(frame).toContain('Edit the projectSettings settings')
    // The picker (which would let you save an ignored route) must not render.
    expect(frame).not.toContain('Set model route')
    expect(closed).toBe(false)
  } finally {
    root.unmount()
    stdin.end()
  }
})

test('shadow mode uses flag-specific guidance for flagSettings (no file to edit)', async () => {
  shadowSource = 'flagSettings'
  const { root, stdin, getOutput } = await renderSelector({
    agentType: 'Explore',
    current: { kind: 'none' },
    onClose: () => {},
  })
  try {
    const frame = await waitForOutput(getOutput, f =>
      f.includes('override your user settings'),
    )
    expect(frame).toContain('--settings flag or SDK inline settings')
    expect(frame).not.toContain('Edit the flagSettings settings')
  } finally {
    root.unmount()
    stdin.end()
  }
})

test('normal mode renders the picker and persists a selected model', async () => {
  shadowSource = null
  let closed = false
  const { root, stdin, getOutput } = await renderSelector({
    agentType: 'verification',
    current: { kind: 'none' },
    onClose: () => {
      closed = true
    },
  })
  try {
    await waitForOutput(getOutput, f => f.includes('Set model route'))
    // Select the first numbered option. buildRouteOptions always lists the
    // built-in aliases first, so option 1 is 'sonnet'.
    stdin.write('1')
    await waitForOutput(getOutput, () => setCalls.length > 0 || closed)
    expect(setCalls.length).toBe(1)
    expect(setCalls[0]).toEqual(['verification', 'sonnet'])
    expect(closed).toBe(true)
  } finally {
    root.unmount()
    stdin.end()
  }
})

test('a failed save is surfaced and keeps the dialog open', async () => {
  shadowSource = null
  setResult = { error: new Error('disk full') }
  let closed = false
  const { root, stdin, getOutput } = await renderSelector({
    agentType: 'verification',
    current: { kind: 'none' },
    onClose: () => {
      closed = true
    },
  })
  try {
    await waitForOutput(getOutput, f => f.includes('Set model route'))
    stdin.write('1')
    const frame = await waitForOutput(getOutput, f => f.includes('Could not save'))
    expect(frame).toContain('disk full')
    expect(closed).toBe(false)
  } finally {
    root.unmount()
    stdin.end()
  }
})

test('typing a custom model id persists the full id on submit', async () => {
  // Regression: the custom-input option once committed on its first keystroke,
  // so typing "gpt-5-mini" saved only "g". The component now buffers the typed
  // value in customIdRef and only calls setAgentRoute on submit. Type the id one
  // character at a time (so a per-keystroke commit would surface as an early or
  // truncated call) and assert exactly one save with the full id.
  shadowSource = null
  let closed = false
  const { root, stdin, getOutput } = await renderSelector({
    agentType: 'verification',
    current: { kind: 'none' },
    onClose: () => {
      closed = true
    },
  })
  try {
    // The custom-input option is appended last; its index depends on how many
    // model aliases the host's settings produce, so read it from the frame
    // instead of hardcoding. Pressing its digit focuses the empty input (the
    // useInput digit handler focuses, rather than submits, an empty input option).
    const listed = await waitForOutput(
      getOutput,
      f => f.includes('Set model route') && f.includes('gpt-5-mini'),
    )
    const inputLine = listed.split('\n').find(l => l.includes('e.g. gpt-5-mini'))!
    const inputIndex = inputLine.trim().match(/^(\d+)\./)?.[1]
    expect(inputIndex).toBeDefined()
    stdin.write(inputIndex!)
    // The focus indicator is figures.pointer, which renders as ❯ on Unix but as
    // ">" on Windows. Match the actual glyph the renderer uses on this platform
    // so the wait does not time out in a Windows checkout.
    await waitForOutput(getOutput, f =>
      f
        .split('\n')
        .some(
          line => line.includes(figures.pointer) && line.includes('gpt-5-mini'),
        ),
    )
    for (const ch of 'gpt-5-mini') {
      stdin.write(ch)
      await Bun.sleep(5)
    }
    // The typed value replaces the "e.g. gpt-5-mini" placeholder once non-empty.
    await waitForOutput(getOutput, f =>
      f.split('\n').some(line => line.includes('gpt-5-mini') && !line.includes('e.g.')),
    )
    stdin.write('\r')
    await waitForOutput(getOutput, () => setCalls.length > 0 || closed)
    expect(setCalls.length).toBe(1)
    expect(setCalls[0]).toEqual(['verification', 'gpt-5-mini'])
    expect(closed).toBe(true)
  } finally {
    root.unmount()
    stdin.end()
  }
})
