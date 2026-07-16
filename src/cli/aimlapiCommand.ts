import { Command as CommanderCommand } from '@commander-js/extra-typings'

import {
  DEFAULT_MODEL,
  MAX_AMOUNT_USD_MINOR,
  MIN_AMOUNT_USD_MINOR,
} from '../integrations/aimlapi/config.js'
import type { AimlapiTopupOptions } from '../integrations/aimlapi/topup.js'

type AimlapiTopupHandler = (options: AimlapiTopupOptions) => Promise<void>
type LoadAimlapiTopupHandler = () => Promise<AimlapiTopupHandler>

const loadAimlapiTopupHandler: LoadAimlapiTopupHandler = async () => {
  const { aimlapiTopup } = await import('./handlers/aimlapi.js')
  return aimlapiTopup
}

export function registerAimlapiCommand(
  program: CommanderCommand,
  loadHandler: LoadAimlapiTopupHandler = loadAimlapiTopupHandler,
): CommanderCommand {
  const aimlapi = program
    .command('aimlapi')
    .description('AI/ML API (aimlapi.com) — top up balance and configure the provider')
  aimlapi
    .command('topup')
    .description(
      'Use passwordless sign-in, open AI/ML API top-up, then configure OpenClaude',
    )
    .option('--email <email>', 'AI/ML API account email (or AIMLAPI_EMAIL env)')
    .option('--code <code>', '6-digit code for an existing account (or AIMLAPI_CODE env)')
    .option(
      '--amount <usd>',
      `Top-up amount in USD (min ${MIN_AMOUNT_USD_MINOR / 100}, max ${MAX_AMOUNT_USD_MINOR / 100})`,
    )
    .option('--auto-top-up', 'Enable automatic top-up at checkout')
    .option(
      '--model <model>',
      'Default model id written into the provider profile',
      DEFAULT_MODEL,
    )
    .option('--partner-id <id>', 'Partner id for rebate attribution (part_...)')
    .option('--no-open', 'Do not auto-open the browser; print the payment URL instead')
    .action(async opts => {
      const handler = await loadHandler()
      await handler({
        email: opts.email,
        code: opts.code,
        amountUsd: opts.amount,
        autoTopUp: opts.autoTopUp,
        model: opts.model,
        partnerId: opts.partnerId,
        noOpen: opts.open === false,
      })
    })

  return aimlapi
}
