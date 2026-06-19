import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../../ink.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { AppStateProvider } from '../../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { AgentDetail } from './AgentDetail.js'

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
  throw new Error(`Timed out waiting for agent detail output:\n${frame}`)
}

function createAgent(agentType: string): AgentDefinition {
  return {
    agentType,
    whenToUse: `Use ${agentType}`,
    source: 'userSettings',
    getSystemPrompt: () => `You are ${agentType}`,
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('components/agents/AgentDetail.test.tsx')
})

afterEach(() => {
  releaseSharedMutationLock()
})

// Regression: while the route picker is open, AgentDetail kept its parent
// `confirm:no` (Esc -> onBack) handler active. Because Confirmation was the
// first-registered context, a bare Esc resolved to confirm:no and exited the
// detail view instead of resolving to the nested select's select:cancel. The
// fix gates confirm:no with isActive=!routing so the picker owns Esc and a
// single Esc only closes the picker, returning to the detail view.
test('Esc closes the route picker without leaving the detail view', async () => {
  // Unique agentType so getAgentRoute does not pick up a host-configured route.
  const agent = createAgent('regression-esc-agent')
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  let backCalls = 0

  try {
    root.render(
      <AppStateProvider>
        <KeybindingSetup>
          <AgentDetail
            agent={agent}
            tools={[]}
            onBack={() => {
              backCalls += 1
            }}
          />
        </KeybindingSetup>
      </AppStateProvider>,
    )

    // Detail view is up.
    await waitForOutput(getOutput, f => f.includes('press "m" to change'))
    // Open the route picker.
    stdin.write('m')
    await waitForOutput(getOutput, f => f.includes('Set model route'))
    // A single Esc should close the picker, not fire onBack.
    stdin.write('\u001B')
    await Bun.sleep(150)
    // Back at the detail view, picker dismissed.
    const frame = await waitForOutput(getOutput, f =>
      f.includes('press "m" to change'),
    )
    expect(frame).not.toContain('Set model route')
    expect(backCalls).toBe(0)
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})
