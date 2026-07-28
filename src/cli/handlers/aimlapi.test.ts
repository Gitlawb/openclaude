import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  claimAimlapiTopupState,
  loadAimlapiTopupState,
  type AimlapiTopupIntent,
} from '../../integrations/aimlapi/topupState.js'
import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import { aimlapiReset } from './aimlapi.js'

const intent: AimlapiTopupIntent = {
  email: 'user@example.com',
  amountUsdMinor: 2500,
  autoTopUp: false,
  partnerId: 'part_test',
  partnerName: 'OpenClaude',
  appBaseUrl: 'https://app.example.test',
  inferenceBaseUrl: 'https://api.example.test/v1',
}

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'openclaude-aimlapi-reset-'))
  setClaudeConfigHomeDirForTesting(directory)
})

afterEach(() => {
  setClaudeConfigHomeDirForTesting(undefined)
  rmSync(directory, { recursive: true, force: true })
})

function captureLog(run: () => void): string {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  try {
    run()
  } finally {
    console.log = original
  }
  return lines.join('\n')
}

test('aimlapi reset discards a stored checkout and reports it', () => {
  claimAimlapiTopupState(intent)

  const output = captureLog(() => aimlapiReset())

  expect(output).toContain('Discarded')
  // The slot is gone, so a fresh (even different-intent) top-up can start.
  expect(loadAimlapiTopupState(intent)).toBeNull()
})

test('aimlapi reset reports when there is nothing to discard', () => {
  const output = captureLog(() => aimlapiReset())

  expect(output).toContain('No in-progress')
  expect(output).not.toContain('Discarded')
})
