/**
 * Skills subcommand handler — lists and inspects configured skills.
 */

import { readFile, rm } from 'fs/promises'
import { resolve } from 'path'
import {
  findCommand,
  getCommandName,
  getCommands,
  type Command,
} from '../../commands.js'
import { initBundledSkills } from '../../skills/bundled/index.js'
import { getCwd } from '../../utils/cwd.js'
import { getDisplayPath } from '../../utils/file.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import {
  formatSkillsListForDisplay,
  formatSkillsListJson,
  locationLabel,
  sourceLabel,
  trustLabel,
  type SkillListCommand,
} from './skillsListFormat.js'
import { validateSkillPath } from './skillsValidation.js'

export { skillsInstallHandler } from './skillsInstall.js'

type SkillCommand = SkillListCommand
type ListOptions = { json?: boolean }
type RemoveOptions = { global?: boolean }

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

function loadSkills(): Promise<SkillCommand[]> {
  initBundledSkills()
  return getCommands(getCwd()).then(commands => commands.filter(isSkillCommand))
}

export async function skillsListHandler(options: ListOptions = {}): Promise<void> {
  const skills = await loadSkills()

  if (options.json) {
    console.log(formatSkillsListJson(skills))
    return
  }

  console.log(formatSkillsListForDisplay(skills))
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

export async function skillsValidateHandler(path: string): Promise<void> {
  const errors = await validateSkillPath(path)
  if (errors.length > 0) {
    console.error(`Skill validation failed for ${getDisplayPath(resolve(path))}:`)
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Skill validation passed for ${getDisplayPath(resolve(path))}.`)
}

export async function skillsRemoveHandler(
  name: string,
  options: RemoveOptions,
): Promise<void> {
  const skills = await loadSkills()
  const targetSource = options.global ? 'userSettings' : 'projectSettings'
  const skill = skills.find(
    candidate =>
      candidate.source === targetSource &&
      candidate.loadedFrom === 'skills' &&
      (candidate.name === name || getCommandName(candidate) === name),
  )

  if (!skill) {
    const scope = options.global ? 'global user' : 'project'
    console.error(`Local ${scope} skill "${name}" not found.`)
    process.exitCode = 1
    return
  }

  if (!skill.skillRoot) {
    console.error(`Skill "${name}" does not have a removable local directory.`)
    process.exitCode = 1
    return
  }

  await rm(skill.skillRoot, { recursive: true, force: false })
  console.log(`Removed skill "${getCommandName(skill)}" from ${sourceLabel(skill)}.`)
}
