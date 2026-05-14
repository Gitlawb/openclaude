import { createHash } from 'crypto'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getDisplayPath } from '../../utils/file.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { validateSkillPath } from './skillsValidation.js'

export type InstallOptions = {
  global?: boolean
  force?: boolean
  registry?: string
}

type SkillRegistryEntry = {
  id?: unknown
  name?: unknown
  title?: unknown
  description?: unknown
  trust?: unknown
  version?: unknown
  license?: unknown
  source?: unknown
  repo?: unknown
  path?: unknown
  homepage?: unknown
  sha256?: unknown
  category?: unknown
  tags?: unknown
  author?: unknown
}

const DEFAULT_SKILLS_REGISTRY_URL =
  'https://raw.githubusercontent.com/Gitlawb/openclaude-skills/main/registry.json'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:'
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function installRoot(options: InstallOptions): string {
  return options.global
    ? join(getClaudeConfigHomeDir(), 'skills')
    : join(getCwd(), '.openclaude', 'skills')
}

function normalizeRegistryEntries(parsed: unknown): SkillRegistryEntry[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isPlainObject)
  }
  if (isPlainObject(parsed) && Array.isArray(parsed.skills)) {
    return parsed.skills.filter(isPlainObject)
  }
  return []
}

async function readSourceText(source: string): Promise<string> {
  if (isUrl(source)) {
    const url = new URL(source)
    if (url.protocol === 'file:') {
      return readFile(url, 'utf8')
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: HTTP ${response.status}`)
    }
    return response.text()
  }

  return readFile(resolve(source), 'utf8')
}

async function readRegistryEntries(source: string): Promise<SkillRegistryEntry[]> {
  let registrySource = source
  if (!isUrl(source)) {
    const resolved = resolve(source)
    try {
      const sourceStats = await stat(resolved)
      registrySource = sourceStats.isDirectory()
        ? join(resolved, 'registry.json')
        : resolved
    } catch {
      registrySource = resolved
    }
  }

  const raw = await readSourceText(registrySource)
  const parsed = JSON.parse(raw) as unknown
  return normalizeRegistryEntries(parsed)
}

async function resolveRegistryEntry(
  idOrName: string,
  options: InstallOptions,
): Promise<SkillRegistryEntry | null> {
  const registrySource =
    options.registry ??
    process.env.OPENCLAUDE_SKILLS_REGISTRY_URL ??
    DEFAULT_SKILLS_REGISTRY_URL
  const entries = await readRegistryEntries(registrySource)
  return (
    entries.find(
      entry =>
        entry.id === idOrName ||
        entry.name === idOrName ||
        (typeof entry.id === 'string' && entry.id.endsWith(`/${idOrName}`)),
    ) ?? null
  )
}

function registryMetadata(entry: SkillRegistryEntry): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  for (const key of [
    'id',
    'name',
    'title',
    'description',
    'category',
    'tags',
    'trust',
    'version',
    'license',
    'author',
    'repo',
    'path',
    'homepage',
    'sha256',
  ] as const) {
    const value = entry[key]
    if (value !== undefined) metadata[key] = value
  }
  return metadata
}

function sha256OfSkillSource(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

function getSkillNameFromMarkdown(markdown: string, fallback: string): string {
  try {
    const { frontmatter } = parseFrontmatter(markdown, 'SKILL.md')
    const name = frontmatter.name
    if (typeof name === 'string' && name.trim() !== '') {
      return name.trim()
    }
  } catch {
    // Validation reports malformed frontmatter later.
  }
  return fallback
}

function skillNameFromSource(source: string): string {
  const withoutTrailingSlash = source.replace(/\/+$/, '')
  const leaf = basename(withoutTrailingSlash)
  if (/^skill\.md$/i.test(leaf)) {
    return basename(dirname(withoutTrailingSlash))
  }
  return leaf.replace(/\.md$/i, '') || 'skill'
}

async function prepareSkillFromMarkdown({
  markdown,
  fallbackName,
  registryEntry,
}: {
  markdown: string
  fallbackName: string
  registryEntry?: SkillRegistryEntry
}): Promise<{ tempDir: string; skillName: string }> {
  const skillName =
    typeof registryEntry?.name === 'string'
      ? registryEntry.name
      : getSkillNameFromMarkdown(markdown, fallbackName)
  const tempRoot = await mkdtemp(join(tmpdir(), 'openclaude-skill-install-'))
  const tempDir = join(tempRoot, skillName)
  await mkdir(tempDir, { recursive: true })
  await writeFile(join(tempDir, 'SKILL.md'), markdown, 'utf8')
  if (registryEntry) {
    await writeFile(
      join(tempDir, 'skill.json'),
      `${JSON.stringify(registryMetadata(registryEntry), null, 2)}\n`,
      'utf8',
    )
  }
  return { tempDir, skillName }
}

async function prepareInstallCandidate(
  spec: string,
  options: InstallOptions,
): Promise<{
  tempDir: string
  skillName: string
  sourceDescription: string
  trust: string
}> {
  if (!isUrl(spec) && (await pathExists(resolve(spec)))) {
    const sourcePath = resolve(spec)
    const sourceStats = await stat(sourcePath)
    if (sourceStats.isDirectory()) {
      const skillName = basename(sourcePath)
      const tempRoot = await mkdtemp(join(tmpdir(), 'openclaude-skill-install-'))
      const tempDir = join(tempRoot, skillName)
      await cp(sourcePath, tempDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: false,
      })
      return {
        tempDir,
        skillName,
        sourceDescription: getDisplayPath(sourcePath),
        trust: 'local',
      }
    }

    const markdown = await readFile(sourcePath, 'utf8')
    const fallbackName = skillNameFromSource(sourcePath)
    const prepared = await prepareSkillFromMarkdown({ markdown, fallbackName })
    return {
      ...prepared,
      sourceDescription: getDisplayPath(sourcePath),
      trust: 'local',
    }
  }

  if (isUrl(spec)) {
    const markdown = await readSourceText(spec)
    const fallbackName = skillNameFromSource(new URL(spec).pathname)
    const prepared = await prepareSkillFromMarkdown({ markdown, fallbackName })
    return {
      ...prepared,
      sourceDescription: spec,
      trust: 'url',
    }
  }

  const entry = await resolveRegistryEntry(spec, options)
  if (!entry || typeof entry.source !== 'string') {
    throw new Error(`Skill "${spec}" was not found in the registry.`)
  }

  const markdown = await readSourceText(entry.source)
  if (typeof entry.sha256 === 'string') {
    const actual = sha256OfSkillSource(markdown)
    if (actual !== entry.sha256) {
      throw new Error(
        `Registry checksum mismatch for "${spec}". Expected ${entry.sha256}, got ${actual}.`,
      )
    }
  }

  const fallbackName =
    typeof entry.name === 'string' ? entry.name : skillNameFromSource(entry.source)
  const prepared = await prepareSkillFromMarkdown({
    markdown,
    fallbackName,
    registryEntry: entry,
  })
  return {
    ...prepared,
    sourceDescription: entry.source,
    trust: typeof entry.trust === 'string' ? entry.trust : 'registry',
  }
}

export async function skillsInstallHandler(
  spec: string,
  options: InstallOptions = {},
): Promise<void> {
  let candidate:
    | Awaited<ReturnType<typeof prepareInstallCandidate>>
    | undefined

  try {
    candidate = await prepareInstallCandidate(spec, options)
    const installErrors = await validateSkillPath(candidate.tempDir)
    if (installErrors.length > 0) {
      console.error(`Skill install failed validation for "${candidate.skillName}":`)
      for (const error of installErrors) {
        console.error(`- ${error}`)
      }
      process.exitCode = 1
      return
    }

    const root = installRoot(options)
    const targetDir = join(root, candidate.skillName)
    if ((await pathExists(targetDir)) && !options.force) {
      console.error(
        `Skill "${candidate.skillName}" already exists at ${getDisplayPath(targetDir)}. Use --force to overwrite.`,
      )
      process.exitCode = 1
      return
    }

    console.log(`Installing skill "${candidate.skillName}"`)
    console.log(`Source: ${candidate.sourceDescription}`)
    console.log(`Trust: ${candidate.trust}`)
    console.log(`Target: ${getDisplayPath(targetDir)}`)

    await mkdir(root, { recursive: true })
    if (options.force) {
      await rm(targetDir, { recursive: true, force: true })
    }
    await cp(candidate.tempDir, targetDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: false,
    })
    console.log(`Installed skill "${candidate.skillName}".`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Skill install failed: ${message}`)
    process.exitCode = 1
  } finally {
    if (candidate) {
      await rm(dirname(candidate.tempDir), { recursive: true, force: true })
    }
  }
}
