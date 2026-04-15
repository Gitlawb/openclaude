import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'

// NOTE: imported from the standalone module. Importing from
// './interactiveHelpers.js' would pull the full onboarding/module graph
// (including optional native-ish deps like @ant/claude-for-chrome-mcp)
// into the test runtime, which isn't needed to exercise confirmDialog.
// The public re-export in interactiveHelpers.tsx still covers the spec'd
// call site.
import { confirmDialog } from './confirmDialog.js'

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

test('confirmDialog: non-TTY resolves to default (yes) immediately without blocking', async () => {
  const { stdout, stdin } = createTestStreams()
  stdin.isTTY = false

  const result = await confirmDialog('Continue?', 'yes', {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  })

  expect(result).toBe(true)
})

test('confirmDialog: non-TTY resolves to default (no) immediately without blocking', async () => {
  const { stdout, stdin } = createTestStreams()
  stdin.isTTY = false

  const result = await confirmDialog('Continue?', 'no', {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  })

  expect(result).toBe(false)
})

test('confirmDialog: defaults to yes when defaultAnswer is omitted (non-TTY path)', async () => {
  const { stdout, stdin } = createTestStreams()
  stdin.isTTY = false

  const result = await confirmDialog('Continue?', undefined, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  })

  expect(result).toBe(true)
})

test('confirmDialog: Enter in TTY returns default=yes', async () => {
  const { stdout, stdin } = createTestStreams()

  const promise = confirmDialog('Proceed?', 'yes', {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  })

  // Let the Ink root mount and subscribe to stdin.
  await Bun.sleep(50)
  stdin.write('\r')

  const result = await promise
  expect(result).toBe(true)
})

test('confirmDialog: Enter in TTY returns default=no', async () => {
  const { stdout, stdin } = createTestStreams()

  const promise = confirmDialog('Proceed?', 'no', {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  })

  await Bun.sleep(50)
  stdin.write('\r')

  const result = await promise
  expect(result).toBe(false)
})

test('confirmDialog: pressing "y" returns true regardless of default', async () => {
  const { stdout, stdin } = createTestStreams()

  const promise = confirmDialog('Proceed?', 'no', {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  })

  await Bun.sleep(50)
  stdin.write('y')

  const result = await promise
  expect(result).toBe(true)
})

test('confirmDialog: pressing "N" returns false regardless of default', async () => {
  const { stdout, stdin } = createTestStreams()

  const promise = confirmDialog('Proceed?', 'yes', {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  })

  await Bun.sleep(50)
  stdin.write('N')

  const result = await promise
  expect(result).toBe(false)
})
