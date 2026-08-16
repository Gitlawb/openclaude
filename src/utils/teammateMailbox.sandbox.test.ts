import { expect, test } from 'bun:test'

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
