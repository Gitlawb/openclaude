import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setClaudeConfigHomeDirForTesting } from './envUtils.js'
import { sendSandboxPermissionResponseViaMailbox } from './swarm/permissionSync.js'
import {
  createSandboxPermissionRequestMessage,
  isSandboxPermissionResponse,
  isSandboxPermissionRequest,
} from './teammateMailbox.js'

test.each(['*', '*.com'])(
  'worker mailbox rejects unsafe sandbox domain pattern %s',
  (host) => {
    expect(() =>
      createSandboxPermissionRequestMessage({
        requestId: 'request-1',
        workerId: 'worker-1',
        workerName: 'worker',
        host,
      }),
    ).toThrow('Invalid sandbox domain pattern')

    expect(
      isSandboxPermissionRequest(
        JSON.stringify({
          type: 'sandbox_permission_request',
          requestId: 'request-1',
          workerId: 'worker-1',
          workerName: 'worker',
          hostPattern: { host },
          createdAt: Date.now(),
        }),
      ),
    ).toBeNull()
  },
)

test('sandbox mailbox parsers return normalized request and response hosts', () => {
  expect(
    isSandboxPermissionRequest(
      JSON.stringify({
        type: 'sandbox_permission_request',
        requestId: 'request-1',
        workerId: 'worker-1',
        workerName: 'worker',
        hostPattern: { host: ' example.com ' },
        createdAt: Date.now(),
      }),
    )?.hostPattern.host,
  ).toBe('example.com')

  expect(
    isSandboxPermissionResponse(
      JSON.stringify({
        type: 'sandbox_permission_response',
        requestId: 'request-1',
        host: ' example.com ',
        allow: true,
        timestamp: new Date().toISOString(),
      }),
    )?.host,
  ).toBe('example.com')
})

test.each([42, null, undefined, { nested: true }])(
  'sandbox mailbox parsers reject non-string host %p',
  host => {
    expect(
      isSandboxPermissionRequest(
        JSON.stringify({
          type: 'sandbox_permission_request',
          requestId: 'request-1',
          workerId: 'worker-1',
          workerName: 'worker',
          hostPattern: { host },
          createdAt: Date.now(),
        }),
      ),
    ).toBeNull()

    expect(
      isSandboxPermissionResponse(
        JSON.stringify({
          type: 'sandbox_permission_response',
          requestId: 'request-1',
          host,
          allow: true,
          timestamp: new Date().toISOString(),
        }),
      ),
    ).toBeNull()
  },
)

test('sandbox mailbox parser rejects a request without a host pattern', () => {
  expect(
    isSandboxPermissionRequest(
      JSON.stringify({
        type: 'sandbox_permission_request',
        requestId: 'request-1',
        workerId: 'worker-1',
        workerName: 'worker',
        createdAt: Date.now(),
      }),
    ),
  ).toBeNull()
})

test('sandbox response reports a failed mailbox append without overwriting the inbox', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'openclaude-sandbox-mailbox-'))
  setClaudeConfigHomeDirForTesting(configDir)

  try {
    const inboxDir = join(configDir, 'teams', 'test-team', 'inboxes')
    const inboxPath = join(inboxDir, 'worker.json')
    await mkdir(inboxDir, { recursive: true })
    await writeFile(inboxPath, 'malformed inbox', 'utf-8')

    expect(
      await sendSandboxPermissionResponseViaMailbox(
        'worker',
        'request-1',
        'example.com',
        true,
        'test-team',
      ),
    ).toBe(false)
    expect(await readFile(inboxPath, 'utf-8')).toBe('malformed inbox')

    await writeFile(inboxPath, '[]', 'utf-8')
    expect(
      await sendSandboxPermissionResponseViaMailbox(
        'worker',
        'request-1',
        'example.com',
        true,
        'test-team',
      ),
    ).toBe(true)
  } finally {
    setClaudeConfigHomeDirForTesting(undefined)
    await rm(configDir, { recursive: true, force: true })
  }
})
