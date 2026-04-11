import { afterEach, expect, test } from 'bun:test'

import {
  _resetForTesting,
  attachAnalyticsSink,
} from 'src/services/analytics/index.js'
import { AuthCodeListener } from './auth-code-listener.js'

afterEach(() => {
  _resetForTesting()
})

test('custom error responses log the error redirect analytics event', () => {
  const events: Array<{
    name: string
    metadata: Record<string, boolean | number | undefined>
  }> = []

  attachAnalyticsSink({
    logEvent: (name, metadata) => {
      events.push({ name, metadata })
    },
    logEventAsync: async () => {},
  })

  const listener = new AuthCodeListener('/callback')
  const response = {
    writeHead: () => {},
    end: () => {},
  }

  ;(listener as any).pendingResponse = response

  listener.handleErrorRedirect(res => {
    res.writeHead(400, {
      'Content-Type': 'text/plain; charset=utf-8',
    })
    res.end('cancelled')
  })

  expect(events).toEqual([
    {
      name: 'tengu_oauth_automatic_redirect_error',
      metadata: { custom_handler: true },
    },
  ])
})
