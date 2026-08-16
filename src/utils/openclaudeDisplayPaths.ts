import { homedir } from 'os'
import { join } from 'path'
import {
  getClaudeConfigHomeDir,
  resolveClaudeConfigHomeDir,
  resolveConfigDirEnv,
} from './envUtils.js'
import { getDisplayPath } from './file.js'

function getUserConfigHomeForDisplay(): string {
  const configDirEnv = resolveConfigDirEnv({
    openClaudeConfigDir: process.env.OPENCLAUDE_CONFIG_DIR,
  })

  if (configDirEnv) {
    return resolveClaudeConfigHomeDir({
      configDirEnv,
      homeDir: homedir(),
    })
  }

  return getClaudeConfigHomeDir()
}

export function getUserSettingsDisplayPath(): string {
  return getDisplayPath(join(getUserConfigHomeForDisplay(), 'settings.json'))
}

export function getUserSkillExampleDisplayPath(): string {
  return getDisplayPath(
    join(getUserConfigHomeForDisplay(), 'skills', '<name>', 'SKILL.md'),
  )
}
