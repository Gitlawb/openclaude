import { expect, mock, test } from 'bun:test'
import { Command as CommanderCommand } from '@commander-js/extra-typings'

import { registerAimlapiCommand } from './aimlapiCommand.js'

test('aimlapi topup forwards the passwordless CLI contract', async () => {
  const handler = mock(async () => {})
  const program = new CommanderCommand().exitOverride()
  registerAimlapiCommand(program, async () => handler)

  await program.parseAsync([
    'node',
    'openclaude',
    'aimlapi',
    'topup',
    '--email',
    'user@example.com',
    '--code',
    '123456',
    '--auto-top-up',
    '--no-open',
  ])

  expect(handler).toHaveBeenCalledWith({
    email: 'user@example.com',
    code: '123456',
    amountUsd: undefined,
    autoTopUp: true,
    model: 'gpt-4o',
    noOpen: true,
  })
})

test('aimlapi topup forwards explicit amount and model', async () => {
  const handler = mock(async () => {})
  const program = new CommanderCommand().exitOverride()
  registerAimlapiCommand(program, async () => handler)

  await program.parseAsync([
    'node',
    'openclaude',
    'aimlapi',
    'topup',
    '--email',
    'user@example.com',
    '--amount',
    '50',
    '--model',
    'gpt-5',
    '--no-open',
  ])

  expect(handler).toHaveBeenCalledWith({
    email: 'user@example.com',
    code: undefined,
    amountUsd: '50',
    autoTopUp: undefined,
    model: 'gpt-5',
    noOpen: true,
  })
})

test('aimlapi topup rejects the removed method option', async () => {
  const program = new CommanderCommand().exitOverride()
  registerAimlapiCommand(program, async () => async () => {})

  await expect(
    program.parseAsync([
      'node',
      'openclaude',
      'aimlapi',
      'topup',
      '--method',
      'card',
    ]),
  ).rejects.toMatchObject({ code: 'commander.unknownOption' })
})
