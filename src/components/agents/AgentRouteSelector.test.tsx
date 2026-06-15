import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { CurrentAgentRoute } from '../../services/api/agentRouteSettings.js'

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
  const real = await import('../../services/api/agentRouteSettings.js')
  mock.module('../../services/api/agentRouteSettings.js', () => ({
    ...real,
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
  root.render(<AgentRouteSelector {...props} />)
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
    // Select the first numbered option.
    stdin.write('1')
    await waitForOutput(getOutput, () => setCalls.length > 0 || closed)
    expect(setCalls.length).toBe(1)
    expect(setCalls[0]![0]).toBe('verification')
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
