import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { render } from '../../ink.js'
import { SnipBoundaryMessage } from './SnipBoundaryMessage.js'

// Regression: HISTORY_SNIP ships enabled, so Message.tsx reaches this render
// branch after the first snip. Previously no source file existed, so the build
// emitted a missing-module-stub whose only export was a default noop — the named
// SnipBoundaryMessage was undefined and the render crashed. Guard the named
// export and a working render.
test('exports a named SnipBoundaryMessage component (not a stub noop)', () => {
  expect(typeof SnipBoundaryMessage).toBe('function')
})

test('renders the snip notice with the removed-message count', async () => {
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  ;(stdout as unknown as { columns: number }).columns = 120

  const message = { snipMetadata: { removedUuids: ['a', 'b', 'c'] } }
  const instance = await render(
    <SnipBoundaryMessage message={message} />,
    stdout as unknown as NodeJS.WriteStream,
  )
  await new Promise(resolve => setTimeout(resolve, 20))
  instance.unmount()

  const frame = stripAnsi(output)
  expect(frame.toLowerCase()).toContain('snipped')
  expect(frame).toContain('3')
})
