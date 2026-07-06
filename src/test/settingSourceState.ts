import {
  getAdditionalDirectoriesForClaudeMd,
  getAllowedSettingSources,
  setAdditionalDirectoriesForClaudeMd,
  setAllowedSettingSources,
} from '../bootstrap/state.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'

export type SettingSourceState = {
  additionalDirectories: string[]
  argv: string[]
  claudeCodeSimple: string | undefined
  sources: SettingSource[]
}

export function enableUserAndProjectSettingSources(): SettingSourceState {
  const originalSources = getAllowedSettingSources()
  const originalAdditionalDirectories = getAdditionalDirectoriesForClaudeMd()
  const originalArgv = [...process.argv]
  const originalClaudeCodeSimple = process.env.CLAUDE_CODE_SIMPLE
  process.argv = process.argv.filter(arg => arg !== '--bare')
  delete process.env.CLAUDE_CODE_SIMPLE
  setAdditionalDirectoriesForClaudeMd([])
  setAllowedSettingSources([
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ])
  resetSettingsCache()
  return {
    additionalDirectories: originalAdditionalDirectories,
    argv: originalArgv,
    claudeCodeSimple: originalClaudeCodeSimple,
    sources: originalSources,
  }
}

export function restoreSettingState(original: SettingSourceState): void {
  process.argv = original.argv
  if (original.claudeCodeSimple === undefined) {
    delete process.env.CLAUDE_CODE_SIMPLE
  } else {
    process.env.CLAUDE_CODE_SIMPLE = original.claudeCodeSimple
  }
  setAdditionalDirectoriesForClaudeMd(original.additionalDirectories)
  setAllowedSettingSources(original.sources)
  resetSettingsCache()
}
