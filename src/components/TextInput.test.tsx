import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../ink.js'
import { AppStateProvider } from '../state/AppState.js'
import { maskTextWithVisibleEdges } from '../utils/Cursor.js'
import TextInput from './TextInput.js'
import VimTextInput from './VimTextInput.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) {
      break
    }

    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) {
      break
    }

    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) {
      lastFrame = frame
    }
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

  return {
    stdout,
    stdin,
    getOutput: () => output,
  }
}

async function waitForOutput(
  getOutput: () => string,
  predicate: (output: string) => boolean,
  timeoutMs = 2500,
): Promise<string> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const output = stripAnsi(extractLastFrame(getOutput()))
    if (predicate(output)) {
      return output
    }
    await Bun.sleep(10)
  }

  throw new Error('Timed out waiting for TextInput test output')
}

function DelayedControlledTextInput(): React.ReactNode {
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const valueTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const offsetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (valueTimerRef.current) {
        clearTimeout(valueTimerRef.current)
      }
      if (offsetTimerRef.current) {
        clearTimeout(offsetTimerRef.current)
      }
    }
  }, [])

  return (
    <AppStateProvider>
      <TextInput
        value={value}
        onChange={nextValue => {
          if (valueTimerRef.current) {
            clearTimeout(valueTimerRef.current)
          }
          valueTimerRef.current = setTimeout(() => {
            setValue(nextValue)
          }, 200)
        }}
        onSubmit={() => {}}
        placeholder="Type here..."
        columns={60}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={nextOffset => {
          if (offsetTimerRef.current) {
            clearTimeout(offsetTimerRef.current)
          }
          offsetTimerRef.current = setTimeout(() => {
            setCursorOffset(nextOffset)
          }, 200)
        }}
        focus
        showCursor
        multiline
      />
    </AppStateProvider>
  )
}

function DelayedControlledVimTextInput(): React.ReactNode {
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const valueTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const offsetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (valueTimerRef.current) {
        clearTimeout(valueTimerRef.current)
      }
      if (offsetTimerRef.current) {
        clearTimeout(offsetTimerRef.current)
      }
    }
  }, [])

  return (
    <AppStateProvider>
      <VimTextInput
        value={value}
        onChange={nextValue => {
          if (valueTimerRef.current) {
            clearTimeout(valueTimerRef.current)
          }
          valueTimerRef.current = setTimeout(() => {
            setValue(nextValue)
          }, 200)
        }}
        onSubmit={() => {}}
        placeholder="Type here..."
        columns={60}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={nextOffset => {
          if (offsetTimerRef.current) {
            clearTimeout(offsetTimerRef.current)
          }
          offsetTimerRef.current = setTimeout(() => {
            setCursorOffset(nextOffset)
          }, 200)
        }}
        initialMode="INSERT"
        focus
        showCursor
        multiline
      />
    </AppStateProvider>
  )
}

test('TextInput renders typed characters before delayed parent value commits', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(<DelayedControlledTextInput />)

  await waitForOutput(getOutput, output => output.includes('Type here...'))
  stdin.write('a')
  stdin.write('b')

  const output = await waitForOutput(
    getOutput,
    frame => frame.includes('ab') && !frame.includes('Type here...'),
  )

  root.unmount()
  stdin.end()
  stdout.end()

  expect(output).toContain('ab')
  expect(output).not.toContain('Type here...')
})

test('maskTextWithVisibleEdges preserves only the first and last three chars', () => {
  expect(maskTextWithVisibleEdges('sk-secret-12345678', '*')).toBe(
    'sk-************678',
  )
  expect(maskTextWithVisibleEdges('abcdef', '*')).toBe('******')
})

test('VimTextInput preserves rapid typed characters before delayed parent value commits', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(<DelayedControlledVimTextInput />)

  await waitForOutput(getOutput, output => output.includes('Type here...'))
  stdin.write('a')
  stdin.write('s')
  stdin.write('d')
  stdin.write('f')

  const output = await waitForOutput(
    getOutput,
    frame => frame.includes('asdf') && !frame.includes('Type here...'),
  )

  root.unmount()
  stdin.end()
  stdout.end()

  expect(output).toContain('asdf')
  expect(output).not.toContain('Type here...')
})
