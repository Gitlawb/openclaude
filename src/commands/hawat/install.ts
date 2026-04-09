/**
 * Hawat install command — Forge integration shim
 *
 * Installs global Hawat components (templates, skills, scripts).
 * Registered as `forge install`.
 */
import type { LocalCommandCall } from '../../types/command.js'
import {
  GLOBAL_HAWAT_DIR,
  GLOBAL_SCRIPTS_DIR,
  GLOBAL_SKILLS_DIR,
} from '../../hawat/utils/paths.js'
import { ensureDir, exists } from '../../hawat/lib/file-manager.js'
import chalk from 'chalk'
import { readFileSync, writeFileSync, cpSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export const call: LocalCommandCall = async (_args: string) => {
  const results: string[] = []

  results.push(chalk.bold('\n  Installing Hawat global components...\n'))

  try {
    // Ensure global directories
    await ensureDir(GLOBAL_HAWAT_DIR)
    await ensureDir(GLOBAL_SCRIPTS_DIR)
    await ensureDir(GLOBAL_SKILLS_DIR)

    results.push(chalk.green(`  ✓ Created ${GLOBAL_HAWAT_DIR}`))

    // Copy scripts
    const scriptsSource = getBundledScriptsPath()
    if (scriptsSource && existsSync(scriptsSource)) {
      const entries = require('fs').readdirSync(scriptsSource)
      for (const entry of entries) {
        cpSync(join(scriptsSource, entry), join(GLOBAL_SCRIPTS_DIR, entry))
      }
      results.push(chalk.green(`  ✓ Copied ${entries.length} scripts to ${GLOBAL_SCRIPTS_DIR}`))
    }

    // Copy skills
    const skillsSource = getBundledSkillsPath()
    if (skillsSource && existsSync(skillsSource)) {
      const entries = require('fs').readdirSync(skillsSource)
      for (const entry of entries) {
        const src = join(skillsSource, entry)
        const dest = join(GLOBAL_SKILLS_DIR, entry)
        if (existsSync(src) && require('fs').statSync(src).isDirectory()) {
          cpSync(src, dest, { recursive: true })
        }
      }
      results.push(chalk.green(`  ✓ Copied skills to ${GLOBAL_SKILLS_DIR}`))
    }

    results.push('')
    results.push(chalk.cyan('  Installation complete. The spice must flow.\n'))

    return { type: 'text' as const, value: results.join('\n') }
  } catch (error: any) {
    return {
      type: 'text' as const,
      value: chalk.red(`\n  Install failed: ${error.message}\n`),
    }
  }
}

function getBundledScriptsPath(): string | null {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    // From src/commands/hawat/ -> scripts/hawat/
    return join(__dirname, '..', '..', '..', 'scripts', 'hawat')
  } catch {
    return null
  }
}

function getBundledSkillsPath(): string | null {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    // From src/commands/hawat/ -> src/skills/bundled/hawat/
    return join(__dirname, '..', '..', 'skills', 'bundled', 'hawat')
  } catch {
    return null
  }
}
