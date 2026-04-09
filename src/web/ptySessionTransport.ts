import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pty from 'node-pty'

import type {
  TerminalTransport,
  TerminalTransportEvent,
} from './terminalTransport.ts'

export type PtySessionRecord = {
  id: string
  cwd: string
}

function resolveNodeExecutable(): string {
  const exec = process.execPath
  const candidate = /node(\.exe)?$/i.test(exec)
    ? exec
    : (() => {
        try {
          const cmd = process.platform === 'win32' ? 'where' : 'which'
          return execFileSync(cmd, ['node'], { encoding: 'utf8' })
            .split(/\r?\n/)[0]!
            .trim()
        } catch {
          return 'node'
        }
      })()

  try {
    return fs.realpathSync.native(candidate)
  } catch {
    try {
      return fs.realpathSync(candidate)
    } catch {
      return candidate
    }
  }
}

function getCliEntrypoint(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(dirname, '../../dist/cli.mjs'),
    path.resolve(dirname, '../cli.mjs'),
    path.resolve(dirname, 'cli.mjs'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  const arg1 = process.argv[1] ?? ''
  if (arg1.endsWith('cli.mjs') || arg1.endsWith('openclaude')) {
    return path.resolve(arg1)
  }

  return fileURLToPath(new URL('../../bin/openclaude', import.meta.url))
}

class PtySessionTransport implements TerminalTransport {
  readonly id: string

  private readonly ptyProcess: pty.IPty
  private readonly listeners = new Set<(event: TerminalTransportEvent) => void>()
  private closed = false

  constructor(session: PtySessionRecord, cols: number, rows: number) {
    this.id = session.id

    const nodeExec = resolveNodeExecutable()
    const args = [getCliEntrypoint()]

    this.ptyProcess = pty.spawn(nodeExec, args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd: session.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    })

    this.ptyProcess.onData(data => {
      this.emit({ type: 'output', data })
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.closed = true
      this.emit({ type: 'exit', code: exitCode })
    })
  }

  attach(listener: (event: TerminalTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  writeInput(data: string): void {
    if (!this.closed) {
      this.ptyProcess.write(data)
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.closed) {
      this.ptyProcess.resize(cols, rows)
    }
  }

  close(): void {
    if (this.closed) {
      return
    }

    this.closed = true
    this.ptyProcess.kill()
  }

  private emit(event: TerminalTransportEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export function createPtySessionTransport(
  session: PtySessionRecord,
  cols: number,
  rows: number,
): TerminalTransport {
  return new PtySessionTransport(session, cols, rows)
}
