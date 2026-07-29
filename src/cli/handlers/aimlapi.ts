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
 * different amount/email) or a checkout-state file that has become corrupt. A
 * settled receipt (an issued key not yet saved to a profile) is kept unless
 * `--force` is passed, since deleting it would lose the paid-for key.
 */
export function aimlapiReset(options: { force?: boolean } = {}): void {
  const result = discardAimlapiCheckoutState(options.force ?? false)
  switch (result) {
    case 'discarded':
      console.log(
        chalk.green(
          '\n  [OK] Discarded the in-progress AI/ML API checkout. Start a new one with `openclaude aimlapi topup`.',
        ),
      )
      break
    case 'kept-settled':
      console.log(
        chalk.yellow(
          '\n  [warn] This checkout already issued an API key that has not been saved to a\n' +
            '         provider profile yet. Re-run `openclaude aimlapi topup` to recover it\n' +
            '         (you will NOT be charged again). To discard it anyway and lose the key,\n' +
            '         run `openclaude aimlapi reset --force`.',
        ),
      )
      break
    case 'kept-unreadable':
      console.log(
        chalk.yellow(
          '\n  [warn] The stored AI/ML API checkout is unreadable and might hold an issued\n' +
            '         API key. It was NOT removed, so a paid-for key is not silently lost.\n' +
            '         Inspect it, then run `openclaude aimlapi reset --force` to remove it\n' +
            '         (this may discard a key — rotate it from the dashboard if unsure).',
        ),
      )
      break
    case 'none':
      console.log(chalk.dim('\n  No in-progress AI/ML API checkout to discard.'))
      break
  }
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
