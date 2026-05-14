/**
 * Skills subcommand handler — lists and inspects configured skills.
 */

import { readFile } from 'fs/promises'
import { lstat, readdir, rm, stat } from 'fs/promises'
import { basename, join, resolve, sep } from 'path'
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

type SkillCommand = Command & { type: 'prompt' }
type RemoveOptions = { global?: boolean }

const REQUIRED_METADATA = [
  'name',
  'title',
  'description',
  'version',
  'category',
  'author',
  'license',
  'trust',
  'riskLevel',
] as const

const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*$/
const UNSAFE_FILE_NAMES = new Set([
  'package.json',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])
const UNSAFE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\bcurl\b[^|\n]*\|\s*(?:sh|bash)\b/i, 'curl pipe-to-shell install command'],
  [/\bbase64\b[^|\n]*\|\s*(?:sh|bash|node|python|python3)\b/i, 'base64 decode-and-execute command'],
  [/\brm\s+-rf\s+(?:\/|\$HOME|~|\*)/i, 'destructive rm command'],
  [/\b(?:api[_-]?key|token|secret|password)\b/i, 'secret or credential request'],
]

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metadataValue(
  frontmatter: Record<string, unknown>,
  jsonMetadata: Record<string, unknown>,
  field: string,
): unknown {
  return jsonMetadata[field] ?? frontmatter[field]
}

async function readOptionalSkillJson(
  skillDir: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(skillDir, 'skill.json'), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function collectSkillFiles(skillDir: string): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relativePath = fullPath.slice(skillDir.length + 1)

      if (relativePath.split(sep).includes('..')) {
        files.push(relativePath)
        continue
      }

      if (entry.isSymbolicLink()) {
        files.push(relativePath)
        continue
      }

      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (entry.isFile()) {
        files.push(relativePath)
      }
    }
  }

  await walk(skillDir)
  return files.sort()
}

async function fileLooksBinary(path: string): Promise<boolean> {
  const sample = await readFile(path)
  return sample.subarray(0, 4096).includes(0)
}

async function validateSkillPath(path: string): Promise<string[]> {
  const errors: string[] = []
  const skillDir = resolve(path)
  const skillFilePath = join(skillDir, 'SKILL.md')

  try {
    const dirStats = await stat(skillDir)
    if (!dirStats.isDirectory()) {
      return [`${getDisplayPath(skillDir)} is not a directory.`]
    }
  } catch {
    return [`${getDisplayPath(skillDir)} does not exist.`]
  }

  try {
    const skillFileStats = await stat(skillFilePath)
    if (!skillFileStats.isFile()) {
      errors.push('SKILL.md is not a file.')
    }
  } catch {
    errors.push('Missing SKILL.md.')
    return errors
  }

  let skillMarkdown = ''
  let frontmatter: Record<string, unknown> = {}
  try {
    skillMarkdown = await readFile(skillFilePath, 'utf8')
    frontmatter = parseFrontmatter(skillMarkdown, skillFilePath).frontmatter
  } catch {
    errors.push('SKILL.md could not be read as UTF-8 markdown.')
  }

  const jsonMetadata = await readOptionalSkillJson(skillDir)
  const name = metadataValue(frontmatter, jsonMetadata, 'name')
  if (typeof name === 'string' && !VALID_SKILL_NAME.test(name)) {
    errors.push(`Invalid skill name "${name}". Use lowercase letters, numbers, dashes, and optional colon namespaces.`)
  }

  for (const field of REQUIRED_METADATA) {
    const value = metadataValue(frontmatter, jsonMetadata, field)
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`Missing required metadata: ${field}.`)
    }
  }

  let files: string[] = []
  try {
    files = await collectSkillFiles(skillDir)
  } catch {
    errors.push('Skill files could not be read.')
  }

  for (const file of files) {
    const fullPath = join(skillDir, file)
    const fileName = basename(file)
    const fileStats = await lstat(fullPath)

    if (fileStats.isSymbolicLink()) {
      errors.push(`Symlinks are not allowed: ${file}.`)
      continue
    }

    if (UNSAFE_FILE_NAMES.has(fileName)) {
      errors.push(`Executable/dependency metadata is not allowed in skills: ${file}.`)
    }

    if (fileStats.isFile() && (await fileLooksBinary(fullPath))) {
      errors.push(`Binary files are not allowed in skills: ${file}.`)
      continue
    }

    if (fileStats.isFile() && /\.(?:md|json|txt|ya?ml|sh|js|ts)$/i.test(file)) {
      const text = await readFile(fullPath, 'utf8')
      for (const [pattern, label] of UNSAFE_TEXT_PATTERNS) {
        if (pattern.test(text)) {
          errors.push(`Unsafe pattern detected in ${file}: ${label}.`)
        }
      }
    }
  }

  return [...new Set(errors)]
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
