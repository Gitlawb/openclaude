/**
 * Skills subcommand handler — lists and inspects configured skills.
 */

import { readFile } from 'fs/promises'
import {
  findCommand,
  getCommandName,
  getCommands,
  type Command,
} from '../../commands.js'
import { initBundledSkills } from '../../skills/bundled/index.js'
import { getCwd } from '../../utils/cwd.js'
import { getDisplayPath } from '../../utils/file.js'

type SkillCommand = Command & { type: 'prompt' }

function isSkillCommand(cmd: Command): cmd is SkillCommand {
  return (
    cmd.type === 'prompt' &&
    (cmd.loadedFrom === 'skills' ||
      cmd.loadedFrom === 'commands_DEPRECATED' ||
      cmd.loadedFrom === 'plugin' ||
      cmd.loadedFrom === 'bundled' ||
      cmd.loadedFrom === 'mcp')
  )
}

function sourceLabel(skill: SkillCommand): string {
  if (skill.source === 'projectSettings') return 'project'
  if (skill.source === 'userSettings') return 'user'
  if (skill.source === 'policySettings') return 'managed'
  return skill.source
}

function trustLabel(skill: SkillCommand): string {
  if (skill.source === 'bundled') return 'bundled'
  if (skill.source === 'plugin') return 'plugin'
  if (skill.source === 'mcp') return 'mcp'
  if (skill.source === 'policySettings') return 'managed'
  return 'local'
}

function locationLabel(skill: SkillCommand): string {
  if (skill.skillFilePath) return getDisplayPath(skill.skillFilePath)
  if (skill.skillRoot) return getDisplayPath(skill.skillRoot)
  return '-'
}

function loadSkills(): Promise<SkillCommand[]> {
  initBundledSkills()
  return getCommands(getCwd()).then(commands => commands.filter(isSkillCommand))
}

function getResolutionState(skills: SkillCommand[]): Map<SkillCommand, string> {
  const winners = new Map<string, SkillCommand>()
  const states = new Map<SkillCommand, string>()

  for (const skill of skills) {
    const key = getCommandName(skill)
    const winner = winners.get(key)
    if (winner) {
      states.set(skill, `shadowed by ${sourceLabel(winner)}`)
    } else {
      winners.set(key, skill)
      states.set(skill, 'enabled')
    }
  }

  return states
}

function formatSkillRow(skill: SkillCommand, state: string): string {
  const version = skill.version ?? '-'
  const title = getCommandName(skill)
  return [
    title,
    sourceLabel(skill),
    trustLabel(skill),
    version,
    state,
    skill.description,
  ].join(' | ')
}

export async function skillsListHandler(): Promise<void> {
  const skills = await loadSkills()
  if (skills.length === 0) {
    console.log(
      'No skills found. Create project skills in .openclaude/skills/<name>/SKILL.md.',
    )
    return
  }

  const states = getResolutionState(skills)
  const enabledCount = [...states.values()].filter(s => s === 'enabled').length
  const lines = [
    `${enabledCount} active skills`,
    '',
    'name | source | trust | version | state | description',
    '--- | --- | --- | --- | --- | ---',
    ...skills
      .slice()
      .sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)))
      .map(skill => formatSkillRow(skill, states.get(skill) ?? 'enabled')),
  ]

  console.log(lines.join('\n'))
}

export async function skillsShowHandler(name: string): Promise<void> {
  const skills = await loadSkills()
  const skill = findCommand(name, skills)
  if (!skill || !isSkillCommand(skill)) {
    console.error(`Skill "${name}" not found.`)
    process.exitCode = 1
    return
  }

  const lines = [
    `Name: ${getCommandName(skill)}`,
    `Source: ${sourceLabel(skill)}`,
    `Trust: ${trustLabel(skill)}`,
    `Version: ${skill.version ?? '-'}`,
    `Location: ${locationLabel(skill)}`,
    `Description: ${skill.description}`,
  ]

  if (skill.whenToUse) {
    lines.push(`When to use: ${skill.whenToUse}`)
  }

  if (skill.allowedTools && skill.allowedTools.length > 0) {
    lines.push(`Allowed tools: ${skill.allowedTools.join(', ')}`)
  }

  if (skill.skillFilePath) {
    try {
      const content = await readFile(skill.skillFilePath, 'utf8')
      lines.push('', '--- SKILL.md ---', content.trimEnd())
    } catch {
      lines.push('', 'SKILL.md could not be read.')
    }
  }

  console.log(lines.join('\n'))
}
