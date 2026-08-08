import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { createSelectionState } from '../selection.js'
import App from './App.js'

type FakeStdin = NodeJS.ReadStream & {
  setRawMode: ReturnType<typeof mock>
  ref: ReturnType<typeof mock>
  unref: ReturnType<typeof mock>
  resume: ReturnType<typeof mock>
  pause: ReturnType<typeof mock>
}

function createFakeStdin(): FakeStdin {
  const stdin = new EventEmitter() as unknown as FakeStdin
  stdin.isTTY = true
  stdin.ref = mock(() => stdin)
  stdin.unref = mock(() => stdin)
  stdin.resume = mock(() => stdin)
  stdin.pause = mock(() => stdin)
  stdin.setEncoding = mock(() => stdin) as unknown as FakeStdin['setEncoding']
  stdin.setRawMode = mock(() => stdin)
  return stdin
}

function createFakeStdout(): NodeJS.WriteStream {
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream
  stdout.isTTY = true
  stdout.write = mock(() => true) as unknown as NodeJS.WriteStream['write']
  return stdout
}

function createApp(stdin: NodeJS.ReadStream): App {
  return new App({
    children: null,
    stdin,
    stdout: createFakeStdout(),
    stderr: createFakeStdout(),
    exitOnCtrlC: true,
    onExit: () => {},
    terminalColumns: 80,
    terminalRows: 24,
    selection: createSelectionState(),
    onSelectionChange: () => {},
    onClickAt: () => false,
    onHoverAt: () => {},
    getHyperlinkAt: () => undefined,
    onOpenHyperlink: () => {},
    onMultiClick: () => {},
    onSelectionDrag: () => {},
    dispatchKeyboardEvent: () => {},
  })
}

describe('App stdin mode setup', () => {
  const originalDataMode = process.env.OPENCLAUDE_USE_DATA_STDIN
  const originalReadableMode = process.env.OPENCLAUDE_USE_READABLE_STDIN

  afterEach(() => {
    if (originalDataMode === undefined) {
      delete process.env.OPENCLAUDE_USE_DATA_STDIN
    } else {
      process.env.OPENCLAUDE_USE_DATA_STDIN = originalDataMode
    }
    if (originalReadableMode === undefined) {
      delete process.env.OPENCLAUDE_USE_READABLE_STDIN
    } else {
      process.env.OPENCLAUDE_USE_READABLE_STDIN = originalReadableMode
    }
  })

  test('uses readable stdin by default without switching the stream to flowing mode', () => {
    delete process.env.OPENCLAUDE_USE_DATA_STDIN
    delete process.env.OPENCLAUDE_USE_READABLE_STDIN
    const stdin = createFakeStdin()
    const app = createApp(stdin)

    app.handleSetRawMode(true)

    expect(stdin.listeners('readable')).toContain(app.handleReadable)
    expect(stdin.listeners('data')).not.toContain(app.handleDataChunk)
    expect(stdin.resume).not.toHaveBeenCalled()

    app.handleSetRawMode(false)
  })

  test('resumes stdin only for opt-in data mode', () => {
    process.env.OPENCLAUDE_USE_DATA_STDIN = '1'
    delete process.env.OPENCLAUDE_USE_READABLE_STDIN
    const stdin = createFakeStdin()
    const app = createApp(stdin)

    app.handleSetRawMode(true)

    expect(stdin.listeners('data')).toContain(app.handleDataChunk)
    expect(stdin.listeners('readable')).not.toContain(app.handleReadable)
    expect(stdin.resume).toHaveBeenCalledTimes(1)

    app.handleSetRawMode(false)
  })

  test('uses data mode when OPENCLAUDE_USE_READABLE_STDIN=0', () => {
    delete process.env.OPENCLAUDE_USE_DATA_STDIN
    process.env.OPENCLAUDE_USE_READABLE_STDIN = '0'
    const stdin = createFakeStdin()
    const app = createApp(stdin)

    app.handleSetRawMode(true)

    expect(stdin.listeners('data')).toContain(app.handleDataChunk)
    expect(stdin.listeners('readable')).not.toContain(app.handleReadable)
    expect(stdin.resume).toHaveBeenCalledTimes(1)

    app.handleSetRawMode(false)
  })
})
