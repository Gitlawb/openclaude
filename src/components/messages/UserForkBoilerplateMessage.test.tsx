import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { render } from '../../ink.js'
import { UserForkBoilerplateMessage } from './UserForkBoilerplateMessage.js'

// Regression: FORK_SUBAGENT ships enabled, so UserTextMessage reaches this
// branch whenever a user message contains <fork-boilerplate> (produced by
// forkSubagent.buildChildMessage). No source file existed, so the build stubbed
// the import to a noop default export and the named component was undefined,
// crashing the render. Guard the named export and a compact render.
test('exports a named UserForkBoilerplateMessage component (not a stub noop)', () => {
  expect(typeof UserForkBoilerplateMessage).toBe('function')
})

const SAMPLE = `<fork-boilerplate>
STOP. READ THIS FIRST.
You are a forked worker process.
RULES (non-negotiable):
1. Do NOT spawn sub-agents.
</fork-boilerplate>

Your directive: investigate the auth refresh flow`

test('renders the directive compactly and hides the boilerplate rules', async () => {
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  ;(stdout as unknown as { columns: number }).columns = 120

  const param = { type: 'text' as const, text: SAMPLE }
  const instance = await render(
    <UserForkBoilerplateMessage addMargin={true} param={param} />,
    stdout as unknown as NodeJS.WriteStream,
  )
  await new Promise(resolve => setTimeout(resolve, 20))
  instance.unmount()

  const frame = stripAnsi(output)
  expect(frame).toContain('investigate the auth refresh flow')
  // The verbose worker rules must not be dumped into the transcript.
  expect(frame).not.toContain('STOP. READ THIS FIRST')
})
