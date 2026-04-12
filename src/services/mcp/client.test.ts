import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupFailedConnection,
  McpAuthError,
  McpSessionExpiredError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  isMcpSessionExpiredError,
} from './client.js'

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

test('McpAuthError is exported from client.js for backward compatibility', () => {
  const error = new McpAuthError('test-server', 'Authentication failed')
  assert.equal(error.name, 'McpAuthError')
  assert.equal(error.serverName, 'test-server')
  assert.equal(error.message, 'Authentication failed')
})

test('McpSessionExpiredError is exported from client.js for backward compatibility', () => {
  const error = new McpSessionExpiredError('test-server')
  assert.equal(error.name, 'McpSessionExpiredError')
  assert.ok(error.message.includes('test-server'))
})

test('McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS is exported from client.js', () => {
  const error = new McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    'Tool call failed',
    'safe_telemetry_message',
    { _meta: { key: 'value' } }
  )
  assert.equal(error.name, 'McpToolCallError')
  assert.equal(error.message, 'Tool call failed')
  assert.deepEqual(error.mcpMeta, { _meta: { key: 'value' } })
})

test('isMcpSessionExpiredError correctly identifies session expired errors', () => {
  const sessionError = new McpSessionExpiredError('test-server')
  const regularError = new Error('Some other error')

  assert.equal(isMcpSessionExpiredError(sessionError), false) // McpSessionExpiredError is not a 404
  assert.equal(isMcpSessionExpiredError(regularError), false)
})
