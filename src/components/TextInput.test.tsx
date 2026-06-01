import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
import React from 'react'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

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

// Regression for #1179: parent strips the leading `!` after entering bash
// mode (numerically: input stays "", cursor stays 0). The local mirror in
// useTextInput must resync to the parent state even though the prop values
// didn't change since lastSeen, otherwise the next keystroke lands beside the
// stale `!` and the buffer shows `!g`, `g!`, or similar instead of `g`.
function BashModeStrippingTextInput(): React.ReactNode {
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  return (
    <AppStateProvider>
      <TextInput
        value={value}
        onChange={nextValue => {
          // Mimic PromptInput.onChange: when leading `!` arrives at start,
          // strip it back to the empty buffer (mode switches in real code).
          if (nextValue.startsWith('!')) {
            setValue(nextValue.slice(1))
            setCursorOffset(nextValue.length - 1)
            return
          }
          setValue(nextValue)
        }}
        onSubmit={() => {}}
        placeholder="Type here..."
        columns={60}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        focus
        showCursor
        multiline
      />
    </AppStateProvider>
  )
}

test('TextInput resyncs local mirror after parent strips bash-mode `!` from empty input', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(<BashModeStrippingTextInput />)

  await Bun.sleep(50)
  stdin.write('!')
  await Bun.sleep(25)
  stdin.write('g')
  await Bun.sleep(25)
  stdin.write('i')
  await Bun.sleep(25)
  stdin.write('t')
  await Bun.sleep(25)

  const output = stripAnsi(extractLastFrame(getOutput()))

  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(25)

  expect(output).toContain('git')
  expect(output).not.toContain('!git')
  expect(output).not.toContain('git!')
  expect(output).not.toContain('!')
})

// Regression: when the buffer is non-empty and the cursor is at offset 0,
// typing `!` must prepend `!` to the buffer rather than emit a bare `!`
// onChange (which would clobber the buffer to "").
function PrependBangTextInput(): React.ReactNode {
  const [value, setValue] = React.useState('git status')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  return (
    <AppStateProvider>
      <TextInput
        value={value}
        onChange={nextValue => {
          if (nextValue.startsWith('!')) {
            setValue(nextValue.slice(1))
            setCursorOffset(0)
            return
          }
          setValue(nextValue)
        }}
        onSubmit={() => {}}
        placeholder="Type here..."
        columns={60}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        focus
        showCursor
        multiline
      />
    </AppStateProvider>
  )
}

test('TextInput prepends `!` to existing buffer when cursor is at offset 0', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(<PrependBangTextInput />)

  await Bun.sleep(50)
  stdin.write('!')
  await Bun.sleep(25)

  const output = stripAnsi(extractLastFrame(getOutput()))

  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(25)

  expect(output).toContain('git status')
  expect(output).not.toMatch(/^!\s*$/m)
})

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
