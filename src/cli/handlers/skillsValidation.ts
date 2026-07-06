import { basename, join, resolve, sep } from 'path'
import { getDisplayPath } from '../../utils/file.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getFsImplementation } from '../../utils/fsOperations.js'

const REQUIRED_METADATA = [
  'name',
  'title',
  'description',
  'version',
  'category',
  'author',
  'license',
  'trust',
] as const

type ValidationOptions = {
  requireRegistryMetadata?: boolean
}

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
  [
    /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{16,}/i,
    'embedded credential-like value',
  ],
  [
    /(?:^|[.!?\n]\s*)(?:please\s+)?(?:send|paste|provide|enter)\s+(?:your\s+)?(?:api[_-]?key|token|secret|password)\b/i,
    'credential collection instruction',
  ],
]
const MAX_SKILL_TEXT_FILE_BYTES = 1024 * 1024

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
  const skillJsonPath = join(skillDir, 'skill.json')
  const fs = getFsImplementation()
  try {
    if ((await fs.stat(skillJsonPath)).size > MAX_SKILL_TEXT_FILE_BYTES) {
      return {}
    }
    const raw = await fs.readFile(skillJsonPath, { encoding: 'utf8' })
    const parsed = JSON.parse(raw) as unknown
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function collectSkillFiles(skillDir: string): Promise<string[]> {
  const files: string[] = []
  const fs = getFsImplementation()

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir)
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
  return (await getFsImplementation().readFileBytes(path, 4096)).includes(0)
}

export async function validateSkillPath(
  path: string,
  options: ValidationOptions = {},
): Promise<string[]> {
  const errors: string[] = []
  const skillDir = resolve(path)
  const skillFilePath = join(skillDir, 'SKILL.md')
  const fs = getFsImplementation()

  try {
    const dirStats = await fs.stat(skillDir)
    if (!dirStats.isDirectory()) {
      return [`${getDisplayPath(skillDir)} is not a directory.`]
    }
  } catch {
    return [`${getDisplayPath(skillDir)} does not exist.`]
  }

  try {
    const skillFileStats = await fs.stat(skillFilePath)
    if (!skillFileStats.isFile()) {
      errors.push('SKILL.md is not a file.')
    }
  } catch {
    errors.push('Missing SKILL.md.')
    return errors
  }

  let skillMarkdown = ''
  let frontmatter: Record<string, unknown> = {}
  const skillFileStats = await fs.stat(skillFilePath)
  if (skillFileStats.size > MAX_SKILL_TEXT_FILE_BYTES) {
    errors.push(`SKILL.md is too large. Skill text files must be at most ${MAX_SKILL_TEXT_FILE_BYTES} bytes.`)
  } else {
    try {
      skillMarkdown = await fs.readFile(skillFilePath, { encoding: 'utf8' })
      frontmatter = parseFrontmatter(skillMarkdown, skillFilePath).frontmatter
    } catch {
      errors.push('SKILL.md could not be read as UTF-8 markdown.')
    }
  }

  const jsonMetadata = await readOptionalSkillJson(skillDir)
  const name = metadataValue(frontmatter, jsonMetadata, 'name')
  if (typeof name === 'string' && !VALID_SKILL_NAME.test(name)) {
    errors.push(`Invalid skill name "${name}". Use lowercase letters, numbers, dashes, and optional colon namespaces.`)
  }

  if (options.requireRegistryMetadata) {
    for (const field of REQUIRED_METADATA) {
      const value = metadataValue(frontmatter, jsonMetadata, field)
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`Missing required metadata: ${field}.`)
      }
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
    const fileStats = await fs.lstat(fullPath)

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
      if (fileStats.size > MAX_SKILL_TEXT_FILE_BYTES) {
        errors.push(`${file} is too large. Skill text files must be at most ${MAX_SKILL_TEXT_FILE_BYTES} bytes.`)
        continue
      }
      const text = await fs.readFile(fullPath, { encoding: 'utf8' })
      for (const [pattern, label] of UNSAFE_TEXT_PATTERNS) {
        if (pattern.test(text)) {
          errors.push(`Unsafe pattern detected in ${file}: ${label}.`)
        }
      }
    }
  }

  return [...new Set(errors)]
}
