import { EventEmitter } from 'node:events'
import { expect, spyOn, test } from 'bun:test'
import { QueryEngine } from '../QueryEngine.js'
import { GrpcServer } from './server.js'

class FakeCall extends EventEmitter {
  writes: unknown[] = []
  ended = false

  write(value: unknown): void {
    this.writes.push(value)
  }

  end(): void {
    this.ended = true
  }
}

async function exerciseInterruption(
  event: 'cancel' | 'end',
): Promise<string | undefined> {
  let releaseSubmit!: () => void
  const submitBlocked = new Promise<void>(resolve => {
    releaseSubmit = resolve
  })
  const submitMessage = spyOn(
    QueryEngine.prototype,
    'submitMessage',
  ).mockImplementation(
    async function* () {
      await submitBlocked
    },
  )
  const interrupt = spyOn(QueryEngine.prototype, 'interrupt')
  try {
    const server = new GrpcServer()
    const call = new FakeCall()
    ;(server as unknown as {
      handleChat(call: FakeCall): void
    }).handleChat(call)
    call.emit('data', {
      request: {
        message: 'test',
        working_directory: process.cwd(),
        model: 'sonnet',
      },
    })
    for (
      let attempts = 0;
      attempts < 100 && interrupt.mock.calls.length === 0;
      attempts++
    ) {
      if (event === 'cancel' && attempts === 1) {
        call.emit('data', { cancel: {} })
      }
      if (event === 'end' && attempts === 1) call.emit('end')
      await Bun.sleep(10)
    }
    return interrupt.mock.calls[0]?.[0]
  } finally {
    releaseSubmit()
    await Bun.sleep(10)
    interrupt.mockRestore()
    submitMessage.mockRestore()
  }
}

test('labels an explicit gRPC cancellation', async () => {
  expect(await exerciseInterruption('cancel')).toBe('grpc_cancel')
})

test('labels a gRPC stream ending while a query is active', async () => {
  expect(await exerciseInterruption('end')).toBe('grpc_stream_end')
})
