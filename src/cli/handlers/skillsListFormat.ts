import { getCommandName, type Command } from '../../types/command.js'
import { getDisplayPath } from '../../utils/file.js'

export type SkillListCommand = Command & { type: 'prompt' }

export function sourceLabel(skill: SkillListCommand): string {
  if (!skill.source) return '-'
  if (skill.source === 'projectSettings') return 'project'
  if (skill.source === 'userSettings') return 'user'
  if (skill.source === 'policySettings') return 'managed'
  return skill.source
}

export function trustLabel(skill: SkillListCommand): string {
  if (skill.source === 'bundled') return 'bundled'
  if (skill.source === 'plugin') return 'plugin'
  if (skill.source === 'mcp') return 'mcp'
  if (skill.source === 'policySettings') return 'managed'
  return 'local'
}

export function locationLabel(skill: SkillListCommand): string {
  if (skill.skillFilePath) return getDisplayPath(skill.skillFilePath)
  if (skill.skillRoot) return getDisplayPath(skill.skillRoot)
  return '-'
}

function getResolutionState(
  skills: SkillListCommand[],
): Map<SkillListCommand, string> {
  const winners = new Map<string, SkillListCommand>()
  const states = new Map<SkillListCommand, string>()

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

function normalizeDescription(text: string | undefined): string {
  const normalized = text?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized || 'No description provided.'
}

function descriptionSummary(text: string | undefined): string {
  const normalized = normalizeDescription(text)
  if (normalized === 'No description provided.') return normalized
  const firstSentence = normalized.match(/^.*?(?:\.(?:\s|$)|$)/)?.[0] ?? normalized
  const withoutSkillPrefix = firstSentence.replace(/^Use this skill to\s+/i, '')
  const summary = (
    withoutSkillPrefix
      ? withoutSkillPrefix[0]!.toUpperCase() + withoutSkillPrefix.slice(1)
      : withoutSkillPrefix
  ).trim()
  return /[.!?]$/.test(summary) ? summary : `${summary}.`
}

export function wrapSkillDescription(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > width && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 0
    ? process.stdout.columns
    : 100
}

function separator(width: number): string {
  return '─'.repeat(width)
}

function formatSkillListRow({
  skill,
  state,
  nameWidth,
  statusWidth,
  sourceWidth,
  descriptionWidth,
  descriptionIndent,
}: {
  skill: SkillListCommand
  state: string | undefined
  nameWidth: number
  statusWidth: number
  sourceWidth: number
  descriptionWidth: number
  descriptionIndent: string
}): string {
  const status = state ?? 'enabled'
  const source = sourceLabel(skill)
  const prefix = `${getCommandName(skill).padEnd(nameWidth)}  ${status.padEnd(statusWidth)}   ${source.padEnd(sourceWidth)}   `
  const descriptionLines = wrapSkillDescription(
    descriptionSummary(skill.description),
    descriptionWidth,
  )
  const lines = [`${prefix}${descriptionLines[0] ?? ''}`]
  lines.push(
    ...descriptionLines.slice(1).map(line => `${descriptionIndent}${line}`),
  )
  return lines.join('\n')
}

function skillListJson(
  skill: SkillListCommand,
  state: string | undefined,
): object {
  return {
    name: getCommandName(skill),
    status: state ?? 'enabled',
    source: sourceLabel(skill),
    trust: trustLabel(skill),
    version: skill.version ?? null,
    description: skill.description ?? null,
    location: locationLabel(skill),
    loadedFrom: skill.loadedFrom ?? null,
    userInvocable: skill.userInvocable ?? null,
    whenToUse: skill.whenToUse ?? null,
    allowedTools: skill.allowedTools ?? [],
  }
}

export function formatSkillsListJson(skills: SkillListCommand[]): string {
  const states = getResolutionState(skills)
  return JSON.stringify(
    {
      enabledCount: [...states.values()].filter(s => s === 'enabled').length,
      skills: skills
        .slice()
        .sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)))
        .map(skill => skillListJson(skill, states.get(skill))),
    },
    null,
    2,
  )
}

export function formatSkillsListForDisplay(
  skills: SkillListCommand[],
  columns = terminalWidth(),
): string {
  const sortedSkills = skills
    .slice()
    .sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)))
  const states = getResolutionState(skills)
  const enabledCount = [...states.values()].filter(s => s === 'enabled').length

  if (skills.length === 0) {
    return ['Skills: 0 enabled', '', 'No skills found.'].join('\n')
  }

  const nameWidth = Math.max(
    'Name'.length,
    ...sortedSkills.map(skill => getCommandName(skill).length),
  )
  const statusWidth = Math.max(
    'Status'.length,
    ...sortedSkills.map(skill => (states.get(skill) ?? 'enabled').length),
  )
  const sourceWidth = Math.max(
    'Source'.length,
    ...sortedSkills.map(skill => sourceLabel(skill).length),
  )
  const descriptionStart =
    nameWidth + 2 + statusWidth + 3 + sourceWidth + 3
  const descriptionWidth = Math.max(20, columns - descriptionStart)
  const descriptionIndent = ' '.repeat(descriptionStart)
  const header = `${'Name'.padEnd(nameWidth)}  ${'Status'.padEnd(statusWidth)}   ${'Source'.padEnd(sourceWidth)}   Description`
  const rule = `${separator(nameWidth)}  ${separator(statusWidth)}   ${separator(sourceWidth)}   ${separator(descriptionWidth)}`
  const rows = sortedSkills.map(skill =>
    formatSkillListRow({
      skill,
      state: states.get(skill),
      nameWidth,
      statusWidth,
      sourceWidth,
      descriptionWidth,
      descriptionIndent,
    }),
  )

  return [
    `Skills: ${enabledCount} enabled`,
    '',
    header,
    rule,
    ...rows,
  ].join('\n')
}
