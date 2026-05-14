import { getCommandName } from '../../types/command.js'
import type { SkillListCommand } from './skillsListFormat.js'

type RemoveOptions = { global?: boolean }

function isMatchingLocalSkill(
  skill: SkillListCommand,
  name: string,
  source: SkillListCommand['source'],
): boolean {
  return (
    skill.source === source &&
    skill.loadedFrom === 'skills' &&
    (skill.name === name || getCommandName(skill) === name)
  )
}

export function findLocalSkillForRemoval(
  skills: SkillListCommand[],
  name: string,
  source: SkillListCommand['source'],
): SkillListCommand | undefined {
  return skills.find(skill => isMatchingLocalSkill(skill, name, source))
}

export function getSkillRemoveNotFoundMessage(
  skills: SkillListCommand[],
  name: string,
  options: RemoveOptions,
): string {
  const alternateSource = options.global ? 'projectSettings' : 'userSettings'
  const alternateSkill = findLocalSkillForRemoval(
    skills,
    name,
    alternateSource,
  )

  if (alternateSkill) {
    return options.global
      ? `Skill "${name}" is installed in this project. Remove it without --global.`
      : `Skill "${name}" is installed globally. Use --global to remove it.`
  }

  return `Skill "${name}" not found.`
}
