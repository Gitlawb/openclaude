import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { createFakeRouter } from './fake-router.mjs'

async function waitForRequest(router) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (router.activeRequests.size) return
    await delay(10)
  }
  throw new Error('Fixture never accepted the partial request')
}

test('a client may abort a partial request without leaking a rejection', async () => {
  const router = await createFakeRouter()
  const socket = connect({ host: '127.0.0.1', port: Number(new URL(router.origin).port) })
  try {
    await once(socket, 'connect')
    socket.write('POST /router/v1/chat/completions HTTP/1.1\r\nHost: fixture\r\nContent-Length: 1000\r\n\r\n{"messages":')
    await waitForRequest(router)
    socket.destroy()
    await router.close()
    assert.deepEqual(router.unexpected, [])
    assert.equal(router.activeRequests.size, 0)
    assert.equal(router.requests.length, 0)
  } finally {
    socket.destroy()
    await router.close()
  }
})

test('fixture shutdown drains in-flight stream handlers', async () => {
  const router = await createFakeRouter()
  try {
    const response = await fetch(`${router.origin}/router/v1/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'AGENT_FIXTURE_0' }], tools: [{}] }),
    })
    assert.equal(router.activeAgents.size, 1)
    await response.body.cancel()
    await router.close()
    assert.equal(router.activeRequests.size, 0)
    assert.equal(router.activeAgents.size, 0)
    assert.deepEqual(router.unexpected, [])
  } finally { await router.close() }
})

test('malformed fixture requests still fail the network gate', async () => {
  const router = await createFakeRouter()
  try {
    await assert.rejects(fetch(`${router.origin}/router/v1/chat/completions`, { method: 'POST', body: 'not valid json' }))
    await router.close()
    assert.equal(router.unexpected.length, 1)
    assert.match(router.unexpected[0], /Fixture handler failed/)
  } finally { await router.close() }
})
