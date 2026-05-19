import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanupFailedConnection, buildMcpStdioCommand } from './client.js'

test('cleanupFailedConnection awaits transport close before resolving', async () => {
  let closed = false
  let resolveClose: (() => void) | undefined

  const transport = {
    close: async () =>
      await new Promise<void>(resolve => {
        resolveClose = () => {
          closed = true
          resolve()
        }
      }),
  }

  const cleanupPromise = cleanupFailedConnection(transport)

  assert.equal(closed, false)
  resolveClose?.()
  await cleanupPromise
  assert.equal(closed, true)
})

test('cleanupFailedConnection closes in-process server and transport', async () => {
  let inProcessClosed = false
  let transportClosed = false

  const inProcessServer = {
    close: async () => {
      inProcessClosed = true
    },
  }

  const transport = {
    close: async () => {
      transportClosed = true
    },
  }

  await cleanupFailedConnection(transport, inProcessServer)

  assert.equal(inProcessClosed, true)
  assert.equal(transportClosed, true)
})

test('buildMcpStdioCommand — no prefix passes command and args through unchanged', () => {
  const { command, args } = buildMcpStdioCommand(
    'node',
    ['server.js', '--port=8080'],
    undefined,
  )
  assert.equal(command, 'node')
  assert.deepEqual(args, ['server.js', '--port=8080'])
})

test('buildMcpStdioCommand — empty string prefix is treated as no prefix', () => {
  const { command, args } = buildMcpStdioCommand(
    'uvx',
    ['mcp-server'],
    '',
  )
  assert.equal(command, 'uvx')
  assert.deepEqual(args, ['mcp-server'])
})

test('buildMcpStdioCommand — single-part prefix: prefix is command, original command is first arg', () => {
  const { command, args } = buildMcpStdioCommand(
    'npx',
    ['@modelcontextprotocol/server-everything', '--debug'],
    'bunx',
  )
  assert.equal(command, 'bunx')
  assert.deepEqual(args, [
    'npx',
    '@modelcontextprotocol/server-everything',
    '--debug',
  ])
})

test('buildMcpStdioCommand — multi-part prefix: structured argv with no shell join', () => {
  const { command, args } = buildMcpStdioCommand(
    'some-server',
    ['--path=/tmp;rm -rf /', '--arg=$(whoami)'],
    'docker run --rm -i',
  )
  assert.equal(command, 'docker')
  assert.deepEqual(args, [
    'run',
    '--rm',
    '-i',
    'some-server',
    '--path=/tmp;rm -rf /',
    '--arg=$(whoami)',
  ])
})

test('buildMcpStdioCommand — whitespace in prefix is normalized (multiple spaces, tabs)', () => {
  const { command, args } = buildMcpStdioCommand(
    'cmd',
    [],
    '  sudo   -u   bob  ',
  )
  assert.equal(command, 'sudo')
  assert.deepEqual(args, ['-u', 'bob', 'cmd'])
})

test('buildMcpStdioCommand — shell -c prefix joins command+args as single string (sh -c pattern)', () => {
  const { command, args } = buildMcpStdioCommand(
    'some-server',
    ['--port=8080', '--debug'],
    'sh -c',
  )
  assert.equal(command, 'sh')
  assert.deepEqual(args, ['-c', 'some-server --port=8080 --debug'])
})
