import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'
import type { APIError } from '@anthropic-ai/sdk'

import { render } from '../../ink.js'
import { briefAPIErrorReason } from '../../services/api/errorUtils.js'
import type { SystemAPIErrorMessage as SystemAPIErrorMessageType } from '../../types/message.js'
import { SystemAPIErrorMessage } from './SystemAPIErrorMessage.js'

function makeMessage(
  overrides: Partial<SystemAPIErrorMessageType>,
): SystemAPIErrorMessageType {
  return {
    type: 'system',
    subtype: 'api_error',
    error: { message: 'Overloaded', status: 529 } as APIError,
    retryInMs: 5000,
    retryAttempt: 1,
    maxRetries: 10,
    ...overrides,
  } as SystemAPIErrorMessageType
}

async function renderToText(message: SystemAPIErrorMessageType) {
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  ;(stdout as unknown as { columns: number }).columns = 120

  const instance = await render(
    <SystemAPIErrorMessage message={message} verbose={false} />,
    stdout as unknown as NodeJS.WriteStream,
  )
  await new Promise(resolve => setTimeout(resolve, 20))
  instance.unmount()
  return stripAnsi(output)
}

// Regression: retries used to be fully hidden until attempt 4, so transient
// rate limits / overloads looked like a frozen app for the first three
// attempts. Early attempts must render a visible (compact) line.
test('attempt 1 renders a compact retry line instead of nothing', async () => {
  const frame = await renderToText(makeMessage({ retryAttempt: 1 }))
  expect(frame).toContain('API overloaded')
  expect(frame.toLowerCase()).toContain('retrying')
  expect(frame).toContain('attempt 1/10')
})

test('compact line omits the full error body', async () => {
  const frame = await renderToText(
    makeMessage({
      retryAttempt: 2,
      error: {
        message: 'Some very detailed upstream error body',
        status: 500,
      } as APIError,
    }),
  )
  expect(frame).toContain('API server error')
  expect(frame).not.toContain('Some very detailed upstream error body')
})

test('attempt 4 renders the full error with retry countdown', async () => {
  const frame = await renderToText(makeMessage({ retryAttempt: 4 }))
  expect(frame).toContain('Overloaded')
  expect(frame.toLowerCase()).toContain('retrying in')
  expect(frame).toContain('attempt 4/10')
})

test('briefAPIErrorReason classifies common failures', () => {
  expect(
    briefAPIErrorReason({ message: 'x', status: 429 } as APIError),
  ).toBe('Rate limited')
  expect(
    briefAPIErrorReason({ message: 'x', status: 529 } as APIError),
  ).toBe('API overloaded')
  expect(
    briefAPIErrorReason({ message: 'x', status: 503 } as APIError),
  ).toBe('API server error')
  expect(
    briefAPIErrorReason({ message: 'Connection error.' } as APIError),
  ).toBe('Connection issue')
  // OpenAI-compat shim network failures carry no cause chain, only text
  expect(
    briefAPIErrorReason({
      message:
        'OpenAI API transport error: fetch failed [openai_category=localhost_resolution_failed]',
    } as APIError),
  ).toBe('Connection issue')
  expect(
    briefAPIErrorReason({ message: 'x', status: 400 } as APIError),
  ).toBe('API error')
  // extractConnectionErrorDetails only walks Error instances, so the
  // timeout-shaped error must be a real Error carrying the code
  expect(
    briefAPIErrorReason(
      Object.assign(new Error('request timed out'), {
        code: 'ETIMEDOUT',
      }) as unknown as APIError,
    ),
  ).toBe('Request timed out')
})
