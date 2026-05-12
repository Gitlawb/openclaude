import type { FrontmatterData } from '../frontmatterParser.js'
import type { PluginManifest } from './schemas.js'

const COMMAND_NAME_PATTERN = /^[a-zA-Z0-9:_-]+$/

export function stringFrontmatter(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function stringListFrontmatter(
  value: unknown,
): string | string[] | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
  }

  return undefined
}

function parseAliasCandidates(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(alias => alias.trim())
      .filter(alias => alias.length > 0)
  }

  if (Array.isArray(value)) {
    return value.flatMap(parseAliasCandidates)
  }

  return []
}

export function buildDirectSkillAliases(options: {
  commandName: string
  displayName: string | undefined
  frontmatter: FrontmatterData
  pluginManifest: PluginManifest
  isSkillCommand: boolean
}): string[] | undefined {
  if (
    !options.pluginManifest.directSkillAliases ||
    !options.isSkillCommand
  ) {
    return undefined
  }

  const candidates = [
    ...(options.displayName ? [options.displayName] : []),
    ...parseAliasCandidates(options.frontmatter.aliases),
  ]
  const aliases: string[] = []

  for (const candidate of candidates) {
    if (
      candidate === options.commandName ||
      !COMMAND_NAME_PATTERN.test(candidate) ||
      aliases.includes(candidate)
    ) {
      continue
    }

    aliases.push(candidate)
  }

  return aliases.length > 0 ? aliases : undefined
}
