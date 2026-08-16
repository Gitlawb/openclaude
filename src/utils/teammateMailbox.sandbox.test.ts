import { expect, test } from 'bun:test'

import {
  createSandboxPermissionRequestMessage,
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
