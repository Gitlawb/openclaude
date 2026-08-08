/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import chalk from 'chalk'

import { AimlapiApiError } from '../../integrations/aimlapi/client.js'
import {
  runAimlapiTopup,
  type AimlapiTopupOptions,
} from '../../integrations/aimlapi/index.js'

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
