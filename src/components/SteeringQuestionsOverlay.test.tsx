import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { afterAll, expect, mock, test } from 'bun:test'
import React from 'react'

import { render } from '../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { SteeringQuestionsOverlay } from './SteeringQuestionsOverlay.js'

await acquireSharedMutationLock('components/SteeringQuestionsOverlay.test.tsx')

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

/** Extract the last rendered frame (the current UI state), falling back to the
 *  full cumulative output when the renderer emitted no sync markers. */
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

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  getOutput: () => string
} {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
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

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(10)
  }

  throw new Error('Timed out waiting for SteeringQuestionsOverlay test condition')
}

async function waitForFrame(
  getOutput: () => string,
  predicate: (frame: string) => boolean,
): Promise<string> {
  let frame = ''

  await waitForCondition(() => {
    frame = stripAnsi(extractLastFrame(getOutput()))
    return predicate(frame)
  })

  return frame
}

/** Send a single keypress and wait for the UI to re-render. Keys must be
 *  written one at a time — batched stdin writes coalesce in the harness. */
async function pressKey(
  stdin: ReturnType<typeof createTestStreams>['stdin'],
  getOutput: () => string,
  key: string,
  expected: (frame: string) => boolean,
): Promise<string> {
  stdin.write(key)
  return waitForFrame(getOutput, expected)
}

test('submits formatted answers after a keyboard-only flow through the tabs', async () => {
  const onSubmit = mock<(formatted: string) => void>()
  const onCancel = mock<() => void>()
  const { stdin, stdout, getOutput } = createTestStreams()

  const instance = await render(
    <SteeringQuestionsOverlay onSubmit={onSubmit} onCancel={onCancel} />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    // Intent tab (text-input) is the initial tab.
    await waitForFrame(
      getOutput,
      frame => frame.includes('Intent') && frame.includes('Type your text'),
    )

    // Type the intent answer. 'q' is unambiguous — it appears nowhere else.
    await pressKey(stdin, getOutput, 'q', frame => frame.includes('q'))

    // Tab to Blockers (multi-select), move down two options, toggle one on.
    await pressKey(
      stdin,
      getOutput,
      '\t',
      frame => frame.includes('Waiting on your input'),
    )
    await pressKey(
      stdin,
      getOutput,
      '\x1b[B',
      frame => frame.includes('> [ ] Requirements unclear'),
    )
    await pressKey(
      stdin,
      getOutput,
      '\x1b[B',
      frame => frame.includes('> [ ] Blocked by a dependency'),
    )
    await pressKey(
      stdin,
      getOutput,
      '\r',
      frame => frame.includes('[x] Blocked by a dependency'),
    )

    // Tab to Scope (single-select), select the first option with Enter.
    await pressKey(
      stdin,
      getOutput,
      '\t',
      frame => frame.includes('Narrow the scope'),
    )
    await pressKey(
      stdin,
      getOutput,
      '\r',
      frame => frame.includes('[x] Narrow the scope'),
    )

    // Tab to Approach (single-select), select the first option.
    await pressKey(
      stdin,
      getOutput,
      '\t',
      frame => frame.includes('Keep the current approach'),
    )
    await pressKey(
      stdin,
      getOutput,
      '\r',
      frame => frame.includes('[x] Keep the current approach'),
    )

    // Tab to the Review tab and confirm the answers are summarized.
    const reviewFrame = await pressKey(
      stdin,
      getOutput,
      '\t',
      frame => frame.includes('Review your answers'),
    )
    expect(reviewFrame).toContain('Intent: q')
    expect(reviewFrame).toContain('Blockers: Blocked by a dependency')
    expect(reviewFrame).toContain('Scope: Narrow the scope')
    expect(reviewFrame).toContain('Approach: Keep the current approach')

    // Enter submits the formatted answers and never calls onCancel.
    await waitForCondition(() => {
      stdin.write('\r')
      return onSubmit.mock.calls.length > 0
    })

    expect(onSubmit.mock.calls[0]![0]).toBe(
      [
        '## Steering',
        '- **Intent**: q',
        '- **Blockers**: Blocked by a dependency',
        '- **Scope**: Narrow the scope',
        '- **Approach**: Keep the current approach',
      ].join('\n'),
    )
    expect(onCancel).not.toHaveBeenCalled()
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('backspace deletes characters in the text-input tab', async () => {
  const onSubmit = mock<(formatted: string) => void>()
  const onCancel = mock<() => void>()
  const { stdin, stdout, getOutput } = createTestStreams()

  const instance = await render(
    <SteeringQuestionsOverlay onSubmit={onSubmit} onCancel={onCancel} />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    const initial = await waitForFrame(
      getOutput,
      frame => frame.includes('Type your text'),
    )
    expect(initial).toContain('What outcome do you want from this task?')

    // 'zi' then backspace leaves 'z'. The placeholder only returns once the
    // value is fully deleted, so assert both stages against the live frame.
    // Each predicate requires the PREVIOUS state to be gone: 'z' matches 'zi'
    // too, so checking `!includes('zi')` ensures the key was actually
    // processed before the next one is written (otherwise the writes coalesce
    // in the harness and both backspaces read the same stale 'zi' closure).
    await pressKey(stdin, getOutput, 'z', frame => frame.includes('z'))
    await pressKey(stdin, getOutput, 'i', frame => frame.includes('zi'))
    await pressKey(
      stdin,
      getOutput,
      '\b',
      frame => frame.includes('z') && !frame.includes('zi'),
    )
    await pressKey(
      stdin,
      getOutput,
      '\b',
      frame =>
        frame.includes('What outcome do you want from this task?') &&
        !frame.includes('z'),
    )
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('escape cancels the overlay without submitting', async () => {
  const onSubmit = mock<(formatted: string) => void>()
  const onCancel = mock<() => void>()
  const { stdin, stdout, getOutput } = createTestStreams()

  const instance = await render(
    <SteeringQuestionsOverlay onSubmit={onSubmit} onCancel={onCancel} />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForFrame(getOutput, frame => frame.includes('Steering Questions'))

    await waitForCondition(() => {
      stdin.write('\x1b')
      return onCancel.mock.calls.length > 0
    })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})
