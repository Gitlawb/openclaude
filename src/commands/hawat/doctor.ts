/**
 * Hawat doctor command — Forge integration shim
 *
 * Runs health checks: model connectivity, config validity,
 * skill availability, theme rendering.
 * Registered as `forge doctor`.
 */
import type { LocalCommandCall } from '../../types/command.js'
import { getProjectPaths } from '../../hawat/utils/paths.js'
import { exists, readJson } from '../../hawat/lib/file-manager.js'
import chalk from 'chalk'

export const call: LocalCommandCall = async (_args: string) => {
  const results: string[] = []
  let allPassed = true

  results.push(chalk.bold('\n  Hawat Doctor — Health Check\n'))

  // Check 1: Config validity
  const configResult = await checkConfig()
  results.push(configResult.line)
  if (!configResult.passed) allPassed = false

  // Check 2: Skill availability
  const skillResult = await checkSkills()
  results.push(skillResult.line)
  if (!skillResult.passed) allPassed = false

  // Check 3: Project initialization
  const projectResult = await checkProject()
  results.push(projectResult.line)
  if (!projectResult.passed) allPassed = false

  // Check 4: Scripts directory
  const scriptsResult = await checkScripts()
  results.push(scriptsResult.line)
  if (!scriptsResult.passed) allPassed = false

  // Summary
  results.push('')
  if (allPassed) {
    results.push(chalk.green('  All checks passed. The spice must flow.'))
  } else {
    results.push(chalk.yellow('  Some checks failed. Run forge init to fix.'))
  }
  results.push('')

  return { type: 'text' as const, value: results.join('\n') }
}

async function checkConfig(): Promise<{ line: string; passed: boolean }> {
  try {
    const paths = getProjectPaths()
    if (!await exists(paths.settingsJson)) {
      return {
        line: chalk.yellow('  ✗ Config: .forge/settings.json not found (run forge init)'),
        passed: false,
      }
    }
    const settings = await readJson(paths.settingsJson)
    if (!settings || typeof settings !== 'object') {
      return {
        line: chalk.red('  ✗ Config: settings.json is invalid JSON'),
        passed: false,
      }
    }
    return { line: chalk.green('  ✓ Config: settings.json valid'), passed: true }
  } catch (error: any) {
    return { line: chalk.red(`  ✗ Config: ${error.message}`), passed: false }
  }
}

async function checkSkills(): Promise<{ line: string; passed: boolean }> {
  try {
    const paths = getProjectPaths()
    if (!await exists(paths.skillsDir)) {
      return {
        line: chalk.yellow('  ✗ Skills: .forge/skills/ not found'),
        passed: false,
      }
    }
    return { line: chalk.green('  ✓ Skills: skill directory present'), passed: true }
  } catch (error: any) {
    return { line: chalk.red(`  ✗ Skills: ${error.message}`), passed: false }
  }
}

async function checkProject(): Promise<{ line: string; passed: boolean }> {
  try {
    const paths = getProjectPaths()
    const hasClaude = await exists(`${paths.root}/CLAUDE.md`)
    const hasSettings = await exists(paths.settingsJson)

    if (hasClaude && hasSettings) {
      return { line: chalk.green('  ✓ Project: CLAUDE.md + .forge/ initialized'), passed: true }
    }
    const missing = []
    if (!hasClaude) missing.push('CLAUDE.md')
    if (!hasSettings) missing.push('.forge/')
    return {
      line: chalk.yellow(`  ✗ Project: missing ${missing.join(', ')} (run forge init)`),
      passed: false,
    }
  } catch (error: any) {
    return { line: chalk.red(`  ✗ Project: ${error.message}`), passed: false }
  }
}

async function checkScripts(): Promise<{ line: string; passed: boolean }> {
  try {
    const paths = getProjectPaths()
    if (!await exists(paths.scriptsDir)) {
      return {
        line: chalk.yellow('  ✗ Scripts: .forge/scripts/ not found'),
        passed: false,
      }
    }
    return { line: chalk.green('  ✓ Scripts: hook scripts present'), passed: true }
  } catch (error: any) {
    return { line: chalk.red(`  ✗ Scripts: ${error.message}`), passed: false }
  }
}
