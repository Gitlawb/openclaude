/**
 * Hawat update command — Forge integration shim
 *
 * Updates project files to match latest templates.
 * Registered as `forge update`.
 */
import type { LocalCommandCall } from '../../types/command.js'
import { getProjectPaths, PROVIDER_CONFIG } from '../../hawat/utils/paths.js'
import { renderNamedTemplate, getDefaultData } from '../../hawat/lib/template-engine.js'
import { getDefaultProjectConfig } from '../../hawat/lib/config-merger.js'
import { exists, writeFile, readJson } from '../../hawat/lib/file-manager.js'
import chalk from 'chalk'
import { basename } from 'path'

export const call: LocalCommandCall = async (args: string) => {
  const paths = getProjectPaths()
  const projectName = basename(paths.root)
  const options = parseArgs(args)

  try {
    if (!await exists(paths.settingsJson)) {
      return {
        type: 'text' as const,
        value: chalk.yellow('Project not initialized. Run forge init first.'),
      }
    }

    const projectConfig = await getDefaultProjectConfig(projectName)
    const templateData = {
      ...getDefaultData(),
      ...projectConfig,
      configDirName: PROVIDER_CONFIG.configDirName,
      projectName,
      updated: new Date().toISOString(),
    }

    const results: string[] = []
    results.push(chalk.bold('\n  Updating project files...\n'))

    // Update settings.json (preserving custom settings)
    const existingSettings = await readJson(paths.settingsJson)
    const newSettings = await renderNamedTemplate('settings.json', templateData)

    if (existingSettings && typeof existingSettings === 'object') {
      // Merge hooks from template into existing settings
      const merged = { ...existingSettings }
      const parsed = JSON.parse(newSettings)
      if (parsed.hooks) {
        merged.hooks = { ...merged.hooks, ...parsed.hooks }
      }
      await writeFile(paths.settingsJson, JSON.stringify(merged, null, 2))
      results.push(chalk.green(`  ✓ Updated: ${PROVIDER_CONFIG.configDirName}/settings.json`))
    } else {
      await writeFile(paths.settingsJson, newSettings)
      results.push(chalk.green(`  ✓ Updated: ${PROVIDER_CONFIG.configDirName}/settings.json`))
    }

    // Don't overwrite CLAUDE.md — preserve user content
    if (options.force) {
      const claudeMd = await renderNamedTemplate('CLAUDE.md', templateData)
      await writeFile(`${paths.root}/CLAUDE.md`, claudeMd)
      results.push(chalk.green('  ✓ Updated: CLAUDE.md'))
    } else {
      results.push(chalk.dim('  Skipped: CLAUDE.md (preserving user content)'))
    }

    results.push('')
    results.push(chalk.cyan('  Update complete.\n'))

    return { type: 'text' as const, value: results.join('\n') }
  } catch (error: any) {
    return {
      type: 'text' as const,
      value: chalk.red(`\n  Update failed: ${error.message}\n`),
    }
  }
}

function parseArgs(args: string): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  const parts = args.split(/\s+/)
  for (const part of parts) {
    if (part === '--force') result.force = true
    if (part === '-p' || part === '--project') result.project = true
  }
  return result
}
