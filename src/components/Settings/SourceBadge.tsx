import React from 'react'
import { Text } from '../../ink.js'
import { getGlobalConfig } from '../../utils/config.js'
import type { SettingSource } from '../../utils/settings/constants.js'
import { resolveThemeSetting } from '../../utils/systemTheme.js'
import { getTheme } from '../../utils/theme.js'

/**
 * Source Badge — small colored chip showing where a setting's effective value
 * comes from (mirrors Dario's `[OC]`/`[CC]`/`[PRJ]` provenance badges, but for
 * openclaude's settings sources). `[SYS]` means the value is a built-in
 * default not defined by any settings file.
 */

export type BadgeSource = SettingSource | 'builtin'

const BADGE_CONFIG: Record<
  BadgeSource,
  {
    label: string
    title: string
    color?: keyof import('../../utils/theme.js').Theme
  }
> = {
  userSettings: {
    label: 'USR',
    title: 'User settings (~/.openclaude/settings.json)',
    color: 'success',
  },
  projectSettings: {
    label: 'PRJ',
    title: 'Project settings (.openclaude/settings.json)',
    color: 'suggestion',
  },
  localSettings: {
    label: 'LOC',
    title: 'Local settings (.openclaude/settings.local.json)',
    color: 'warning',
  },
  flagSettings: {
    label: 'FLG',
    title: 'CLI flag (--settings)',
    color: 'error',
  },
  policySettings: {
    label: 'POL',
    title: 'Managed policy settings',
    color: 'merged',
  },
  builtin: {
    label: 'SYS',
    title: 'Built-in default',
    color: 'inactive',
  },
}

export function SourceBadge({
  source,
  dim = false,
}: {
  source: BadgeSource
  dim?: boolean
}): React.ReactNode {
  const theme = getTheme(resolveThemeSetting(getGlobalConfig().theme))
  const config = BADGE_CONFIG[source] ?? BADGE_CONFIG.builtin
  const color = config.color ? theme[config.color] : theme.inactive
  return (
    <Text color={color} dimColor={dim}>
      {' '}
      [{config.label}]
    </Text>
  )
}
