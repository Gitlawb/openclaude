/**
 * Hawat uninstall command — Forge integration shim
 *
 * Removes Hawat project and/or global files.
 * Registered as `forge uninstall`.
 */
import type { LocalCommandCall } from '../../types/command.js'
import {
  GLOBAL_HAWAT_DIR,
  getProjectPaths,
  PROVIDER_CONFIG,
} from '../../hawat/utils/paths.js'
import { exists } from '../../hawat/lib/file-manager.js'
import chalk from 'chalk'
import { rmSync, existsSync } from 'fs'

export const call: LocalCommandCall = async (args: string) => {
  const options = parseArgs(args)
  const paths = getProjectPaths()
  const results: string[] = []

  results.push(chalk.bold('\n  Uninstalling Hawat...\n'))

  try {
    // Remove project files
    if (options.project) {
      if (existsSync(paths.providerDir)) {
        rmSync(paths.providerDir, { recursive: true, force: true })
        results.push(chalk.green(`  ✓ Removed: ${PROVIDER_CONFIG.configDirName}/`))
      }
      if (existsSync(paths.contextDir)) {
        rmSync(paths.contextDir, { recursive: true, force: true })
        results.push(chalk.green('  ✓ Removed: .forge/context/'))
      }
    }

    // Remove global files
    if (existsSync(GLOBAL_HAWAT_DIR)) {
      rmSync(GLOBAL_HAWAT_DIR, { recursive: true, force: true })
      results.push(chalk.green(`  ✓ Removed: ${GLOBAL_HAWAT_DIR}`))
    }

    if (results.length === 2) {
      results.push(chalk.dim('  Nothing to remove.'))
    }

    results.push('')
    results.push(chalk.cyan('  Uninstall complete.\n'))

    return { type: 'text' as const, value: results.join('\n') }
  } catch (error: any) {
    return {
      type: 'text' as const,
      value: chalk.red(`\n  Uninstall failed: ${error.message}\n`),
    }
  }
}

function parseArgs(args: string): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  const parts = args.split(/\s+/)
  for (const part of parts) {
    if (part === '-p' || part === '--project') result.project = true
    if (part === '-g' || part === '--global') result.global = true
  }
  return result
}
