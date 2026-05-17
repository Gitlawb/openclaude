import { createHash } from 'crypto'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { coerce, lt } from 'semver'
import { getCwd } from '../../utils/cwd.js'
import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getDisplayPath } from '../../utils/file.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { publicBuildVersion } from '../../utils/version.js'
import { validateSkillPath } from './skillsValidation.js'

export type InstallOptions = {
  global?: boolean
  force?: boolean
  registry?: string
  projectDir?: string
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
  min_openclaude_version?: unknown
  tools_required?: unknown
  category?: unknown
  tags?: unknown
  author?: unknown
}

const DEFAULT_SKILLS_REGISTRY_URL =
  'https://raw.githubusercontent.com/Gitlawb/openclaude-skills/main/registry.json'
const VALID_INSTALL_SKILL_NAME = /^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*$/
const REMOTE_SOURCE_TIMEOUT_MS = 30_000
const MAX_REMOTE_SOURCE_BYTES = 1024 * 1024

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
    : join(options.projectDir ?? getCwd(), '.openclaude', 'skills')
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

    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: REMOTE_SOURCE_TIMEOUT_MS,
    })
    let response: Response
    try {
      response = await fetch(url, { signal })
    } finally {
      cleanup()
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: HTTP ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    if (
      contentLength &&
      Number.parseInt(contentLength, 10) > MAX_REMOTE_SOURCE_BYTES
    ) {
      throw new Error(`Remote source ${source} is too large to install.`)
    }

    if (!response.body) {
      return ''
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let bytesRead = 0
    let text = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > MAX_REMOTE_SOURCE_BYTES) {
        await reader.cancel()
        throw new Error(`Remote source ${source} is too large to install.`)
      }
      text += decoder.decode(value, { stream: true })
    }

    return text + decoder.decode()
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
    'min_openclaude_version',
    'tools_required',
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

function requireRegistrySha256(entry: SkillRegistryEntry, spec: string): string {
  if (typeof entry.sha256 !== 'string' || entry.sha256.trim() === '') {
    throw new Error(
      `Registry entry "${spec}" is missing sha256. Refusing to install an unpinned skill.`,
    )
  }
  return entry.sha256.trim()
}

function assertCompatibleOpenClaudeVersion(entry: SkillRegistryEntry, spec: string): string | undefined {
  if (
    typeof entry.min_openclaude_version !== 'string' ||
    entry.min_openclaude_version.trim() === ''
  ) {
    return undefined
  }

  const minimum = entry.min_openclaude_version.trim()
  const current = coerce(publicBuildVersion)
  const required = coerce(minimum)

  if (!current || !required) {
    throw new Error(
      `Registry entry "${spec}" has an invalid min_openclaude_version value: ${minimum}.`,
    )
  }

  if (lt(current, required)) {
    throw new Error(
      `Skill "${spec}" requires OpenClaude ${required.version} or newer. Current version is ${current.version}.`,
    )
  }

  return minimum
}

function trustInstallWarning(trust: string): string | null {
  if (trust === 'official') {
    return null
  }
  if (trust === 'verified') {
    return 'Warning: this verified community skill was reviewed, but is not maintained as an official OpenClaude skill.'
  }
  if (trust === 'community') {
    return 'Warning: this community skill passed registry validation, but may not be deeply reviewed or maintained by OpenClaude maintainers.'
  }
  if (trust === 'deprecated') {
    return 'Warning: this skill is marked deprecated. Install only if you intentionally need this older workflow.'
  }
  return `Warning: this skill has trust tier "${trust}". Review SKILL.md before using it.`
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

function normalizeInstallSkillName(value: string): string {
  const skillName = value.trim()
  if (!VALID_INSTALL_SKILL_NAME.test(skillName)) {
    throw new Error(
      `Invalid skill name "${value}". Use lowercase letters, numbers, dashes, and optional colon namespaces.`,
    )
  }
  return skillName
}

function resolveContainedPath(root: string, child: string): string {
  const resolvedRoot = resolve(root)
  const resolvedChild = resolve(resolvedRoot, child)
  const relativePath = relative(resolvedRoot, resolvedChild)

  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `Invalid skill install path "${child}". Skill paths must stay inside ${getDisplayPath(resolvedRoot)}.`,
    )
  }

  return resolvedChild
}

function skillNameToInstallPath(skillName: string): string {
  return join(...skillName.split(':'))
}

function resolveSkillInstallPath(root: string, skillName: string): string {
  return resolveContainedPath(root, skillNameToInstallPath(skillName))
}

async function getSkillNameFromDirectory(sourcePath: string): Promise<string> {
  const fallbackName = basename(sourcePath)
  try {
    const markdown = await readFile(join(sourcePath, 'SKILL.md'), 'utf8')
    return getSkillNameFromMarkdown(markdown, fallbackName)
  } catch {
    // Validation reports missing or malformed SKILL.md after the directory is staged.
    return fallbackName
  }
}

async function prepareSkillFromMarkdown({
  markdown,
  fallbackName,
  registryEntry,
}: {
  markdown: string
  fallbackName: string
  registryEntry?: SkillRegistryEntry
}): Promise<{ tempRoot: string; tempDir: string; skillName: string }> {
  const skillName = normalizeInstallSkillName(
    typeof registryEntry?.name === 'string'
      ? registryEntry.name
      : getSkillNameFromMarkdown(markdown, fallbackName),
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openclaude-skill-install-'))
  const tempDir = resolveSkillInstallPath(tempRoot, skillName)
  await mkdir(tempDir, { recursive: true })
  await writeFile(join(tempDir, 'SKILL.md'), markdown, 'utf8')
  if (registryEntry) {
    await writeFile(
      join(tempDir, 'skill.json'),
      `${JSON.stringify(registryMetadata(registryEntry), null, 2)}\n`,
      'utf8',
    )
  }
  return { tempRoot, tempDir, skillName }
}

async function prepareInstallCandidate(
  spec: string,
  options: InstallOptions,
): Promise<{
  tempDir: string
  tempRoot: string
  skillName: string
  sourceDescription: string
  trust: string
  toolsRequired: string[]
  minOpenClaudeVersion?: string
}> {
  if (!isUrl(spec) && (await pathExists(resolve(spec)))) {
    const sourcePath = resolve(spec)
    const sourceStats = await stat(sourcePath)
    if (sourceStats.isDirectory()) {
      const skillName = normalizeInstallSkillName(
        await getSkillNameFromDirectory(sourcePath),
      )
      const tempRoot = await mkdtemp(join(tmpdir(), 'openclaude-skill-install-'))
      const tempDir = resolveSkillInstallPath(tempRoot, skillName)
      await cp(sourcePath, tempDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: false,
      })
      return {
        tempRoot,
        tempDir,
        skillName,
        sourceDescription: getDisplayPath(sourcePath),
        trust: 'local',
        toolsRequired: [],
      }
    }

    const markdown = await readFile(sourcePath, 'utf8')
    const fallbackName = skillNameFromSource(sourcePath)
    const prepared = await prepareSkillFromMarkdown({ markdown, fallbackName })
    return {
      ...prepared,
      sourceDescription: getDisplayPath(sourcePath),
      trust: 'local',
      toolsRequired: [],
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
      toolsRequired: [],
    }
  }

  const entry = await resolveRegistryEntry(spec, options)
  if (!entry || typeof entry.source !== 'string') {
    throw new Error(`Skill "${spec}" was not found in the registry.`)
  }

  const expectedSha256 = requireRegistrySha256(entry, spec)
  const minOpenClaudeVersion = assertCompatibleOpenClaudeVersion(entry, spec)
  const markdown = await readSourceText(entry.source)
  const actual = sha256OfSkillSource(markdown)
  if (actual !== expectedSha256) {
    throw new Error(
      `Registry checksum mismatch for "${spec}". Expected ${expectedSha256}, got ${actual}.`,
    )
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
    toolsRequired: stringArray(entry.tools_required),
    minOpenClaudeVersion,
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
    const targetDir = resolveSkillInstallPath(root, candidate.skillName)
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
    const trustWarning = trustInstallWarning(candidate.trust)
    if (trustWarning) {
      console.warn(trustWarning)
    }
    if (candidate.toolsRequired.length > 0) {
      console.log(`Tools required: ${candidate.toolsRequired.join(', ')}`)
    }
    if (candidate.minOpenClaudeVersion) {
      console.log(`Requires OpenClaude: >= ${candidate.minOpenClaudeVersion}`)
    }
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
      await rm(candidate.tempRoot, { recursive: true, force: true })
    }
  }
}
