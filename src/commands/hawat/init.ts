/**
 * Hawat init command — Forge integration shim
 *
 * Delegates to the Hawat CLI's init logic, bypassing Commander.js.
 * Registered as `forge init` (top-level).
 */
import type { LocalCommandCall } from '../../types/command.js'
import { getProjectPaths } from '../../hawat/utils/paths.js'
import { renderNamedTemplate, getDefaultData } from '../../hawat/lib/template-engine.js'
import { getDefaultProjectConfig } from '../../hawat/lib/config-merger.js'
import { ensureDir, exists, writeFile } from '../../hawat/lib/file-manager.js'
import { basename } from 'path'
import chalk from 'chalk'

export const call: LocalCommandCall = async (args: string) => {
  const paths = getProjectPaths()
  const projectName = basename(paths.root)
  const options = parseArgs(args)
  const force = options.force || options.yes

  try {
    // Check if already initialized
    if (!force && await exists(paths.settingsJson)) {
      return {
        type: 'text' as const,
        value: chalk.yellow('Project already initialized. Use --force to overwrite.'),
      }
    }

    // Ensure directories exist
    await ensureDir(paths.providerDir)
    await ensureDir(paths.scriptsDir)
    await ensureDir(paths.contextDir)

    // Get project config and render templates
    const projectConfig = await getDefaultProjectConfig(projectName)
    const templateData = {
      ...getDefaultData(),
      ...projectConfig,
      configDirName: 'forge',
      projectName,
    }

    // Generate CLAUDE.md
    const claudeMd = await renderNamedTemplate('CLAUDE.md', templateData)
    const claudeMdPath = `${paths.root}/CLAUDE.md`
    if (!await exists(claudeMdPath) || force) {
      await writeFile(claudeMdPath, claudeMd)
    }

    // Generate settings.json
    const settingsJson = await renderNamedTemplate('settings.json', templateData)
    await writeFile(paths.settingsJson, settingsJson)

    // Generate context.md
    const contextMd = await renderNamedTemplate('context.md', templateData)
    await writeFile(paths.contextMd, contextMd)

    // Generate checkpoint.md
    const checkpointMd = await renderNamedTemplate('checkpoint.md', templateData)
    await writeFile(paths.checkpointMd, checkpointMd)

    // Generate critical-context.md
    const criticalContextMd = await renderNamedTemplate('critical-context', templateData)
    await writeFile(paths.criticalContextMd, criticalContextMd)

    const output = [
      chalk.green(`\n  Initialized Hawat orchestration for ${chalk.bold(projectName)}`),
      '',
      chalk.dim('  Files created:'),
      chalk.dim(`    ${paths.providerDir}/settings.json`),
      chalk.dim('    CLAUDE.md'),
      chalk.dim(`    ${paths.contextMd}`),
      chalk.dim(`    ${paths.checkpointMd}`),
      '',
      chalk.cyan('  The spice must flow.'),
      '',
    ].join('\n')

    return { type: 'text' as const, value: output }
  } catch (error: any) {
    return {
      type: 'text' as const,
      value: chalk.red(`Init failed: ${error.message}`),
    }
  }
}

function parseArgs(args: string): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  const parts = args.split(/\s+/)
  for (const part of parts) {
    if (part === '-f' || part === '--full') result.full = true
    if (part === '-m' || part === '--minimal') result.minimal = true
    if (part === '-y' || part === '--yes') result.yes = true
    if (part === '--force') result.force = true
  }
  return result
}
