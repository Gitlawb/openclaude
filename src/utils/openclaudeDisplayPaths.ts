import { homedir } from 'os'
import { join } from 'path'
import {
  resolveClaudeConfigHomeDir,
  resolveConfigDirEnv,
} from './envUtils.js'
import { getDisplayPath } from './file.js'

function getUserConfigHomeForDisplay(): string {
  const configDirEnv = resolveConfigDirEnv({
    openClaudeConfigDir: process.env.OPENCLAUDE_CONFIG_DIR,
    legacyConfigDir: process.env.CLAUDE_CONFIG_DIR,
  })

  return resolveClaudeConfigHomeDir({
    configDirEnv,
    homeDir: homedir(),
  })
}

export function getUserSettingsDisplayPath(): string {
  return getDisplayPath(join(getUserConfigHomeForDisplay(), 'settings.json'))
}

export function getUserSkillExampleDisplayPath(): string {
  return getDisplayPath(
    join(getUserConfigHomeForDisplay(), 'skills', '<name>', 'SKILL.md'),
  )
}
