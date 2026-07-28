/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import chalk from 'chalk'

import { AimlapiApiError } from '../../integrations/aimlapi/client.js'
import {
  discardAimlapiCheckoutState,
  runAimlapiTopup,
  type AimlapiTopupOptions,
} from '../../integrations/aimlapi/index.js'

/**
 * Discard any stored checkout so a new top-up can start. The escape hatch for an
 * interrupted checkout whose session went terminal (its resume token blocks a
 * different amount/email) or a checkout-state file that has become corrupt.
 */
export function aimlapiReset(): void {
  const discarded = discardAimlapiCheckoutState()
  console.log(
    discarded
      ? chalk.green(
          '\n  [OK] Discarded the in-progress AI/ML API checkout. Start a new one with `openclaude aimlapi topup`.',
        )
      : chalk.dim('\n  No in-progress AI/ML API checkout to discard.'),
  )
}

export async function aimlapiTopup(options: AimlapiTopupOptions): Promise<void> {
  try {
    await runAimlapiTopup(options)
  } catch (error) {
    if (error instanceof AimlapiApiError) {
      console.error(chalk.red(`\n  ✗ ${error.message}`))
      if (error.body) {
        console.error(chalk.dim(`    ${error.body}`))
      }
    } else {
      const message = error instanceof Error ? error.message : String(error)
      console.error(chalk.red(`\n  ✗ ${message}`))
    }
    process.exit(1)
  }
}
