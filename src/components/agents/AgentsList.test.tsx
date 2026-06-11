import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { AgentsList } from './AgentsList.js'

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

  while (Date.now() - startedAt < 2500) {
    const frame = stripAnsi(extractLastFrame(getOutput()))
    if (predicate(frame)) return frame
    await Bun.sleep(10)
  }

  throw new Error('Timed out waiting for agents list output')
}

function createAgent(
  agentType: string,
  source: AgentDefinition['source'] = 'userSettings',
): AgentDefinition {
  const base = {
    agentType,
    whenToUse: `Use ${agentType}`,
    getSystemPrompt: () => `You are ${agentType}`,
  }
  // The AgentDefinition union requires variant-specific fields per source.
  if (source === 'built-in') {
    return { ...base, source, baseDir: 'built-in' }
  }
  if (source === 'plugin') {
    return { ...base, source, plugin: 'test-plugin' }
  }
  return { ...base, source }
}

beforeEach(async () => {
  await acquireSharedMutationLock('components/agents/AgentsList.test.tsx')
})

afterEach(() => {
  releaseSharedMutationLock()
})

test('shows and marks the active session agent', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AgentsList
      source="all"
      agents={[createAgent('reviewer'), createAgent('planner')]}
      activeAgentName="reviewer"
      onBack={() => {}}
      onSelect={() => {}}
    />,
  )

  try {
    const output = await waitForOutput(
      getOutput,
      frame => frame.includes('Current session agent: reviewer'),
    )
    expect(output).toContain('reviewer')
    expect(output).toContain('active')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('shows none when no session agent is active', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AgentsList
      source="all"
      agents={[]}
      activeAgentName={undefined}
      onBack={() => {}}
      onSelect={() => {}}
    />,
  )

  try {
    await waitForOutput(getOutput, frame =>
      frame.includes('Current session agent: none'),
    )
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('does not mark shadowed agent rows as active', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AgentsList
      source="all"
      agents={[
        { ...createAgent('reviewer', 'built-in'), overriddenBy: 'userSettings' },
        createAgent('reviewer'),
      ]}
      activeAgentName="reviewer"
      onBack={() => {}}
      onSelect={() => {}}
    />,
  )

  try {
    const output = await waitForOutput(
      getOutput,
      frame => frame.includes('shadowed by user') && frame.includes('active'),
    )

    expect(output.match(/\bactive\b/g) ?? []).toHaveLength(1)
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})
