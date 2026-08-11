import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { coerce, lt } from 'semver'
import { getCwd } from '../../utils/cwd.js'
import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getDisplayPath } from '../../utils/file.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { publicBuildVersion } from '../../utils/version.js'
import { validateSkillPath } from './skillsValidation.js'

export type InstallOptions = {
  global?: boolean
  force?: boolean
  registry?: string
  projectDir?: string
  sha256?: string
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

type RegistryEntriesResult = {
  entries: SkillRegistryEntry[]
  registrySource: string
}

const DEFAULT_SKILLS_REGISTRY_URL =
  'https://raw.githubusercontent.com/Gitlawb/openclaude-skills/main/registry.json'
const VALID_INSTALL_SKILL_NAME = /^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*$/
const MAX_INSTALL_SKILL_NAME_LENGTH = 120
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
    await getFsImplementation().stat(path)
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
      return getFsImplementation().readFile(fileURLToPath(url), {
        encoding: 'utf8',
      })
    }

    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: REMOTE_SOURCE_TIMEOUT_MS,
    })
    try {
      const response = await fetch(url, { signal })
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
    } finally {
      cleanup()
    }
  }

  return getFsImplementation().readFile(resolve(source), { encoding: 'utf8' })
}

async function readRegistryEntries(source: string): Promise<RegistryEntriesResult> {
  let registrySource = source
  if (!isUrl(source)) {
    const resolved = resolve(source)
    try {
      const sourceStats = await getFsImplementation().stat(resolved)
      registrySource = sourceStats.isDirectory()
        ? join(resolved, 'registry.json')
        : resolved
    } catch {
      registrySource = resolved
    }
  }

  const raw = await readSourceText(registrySource)
  const parsed = JSON.parse(raw) as unknown
  return {
    entries: normalizeRegistryEntries(parsed),
    registrySource,
  }
}

function resolveRegistryEntrySource(
  entrySource: string,
  registrySource: string,
): string {
  if (isUrl(entrySource) || isAbsolute(entrySource)) {
    return entrySource
  }

  if (isUrl(registrySource)) {
    return new URL(entrySource, registrySource).toString()
  }

  return resolve(dirname(registrySource), entrySource)
}

async function resolveRegistryEntry(
  idOrName: string,
  options: InstallOptions,
): Promise<{ entry: SkillRegistryEntry; registrySource: string } | null> {
  const registrySource =
    options.registry ??
    process.env.OPENCLAUDE_SKILLS_REGISTRY_URL ??
    DEFAULT_SKILLS_REGISTRY_URL
  const registry = await readRegistryEntries(registrySource)
  const entry = registry.entries.find(
    candidate =>
      candidate.id === idOrName ||
      candidate.name === idOrName ||
      (typeof candidate.id === 'string' &&
        candidate.id.endsWith(`/${idOrName}`)),
  )

  return entry ? { entry, registrySource: registry.registrySource } : null
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
  return normalizeExpectedSha256(entry.sha256) ?? ''
}

function normalizeExpectedSha256(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('--sha256 must be a 64-character lowercase or uppercase hex digest.')
  }
  return normalized
}

function assertSha256Matches(text: string, expectedSha256: string, spec: string): void {
  const actual = sha256OfSkillSource(text)
  if (actual !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for "${spec}". Expected ${expectedSha256}, got ${actual}.`,
    )
  }
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
  if (
    !VALID_INSTALL_SKILL_NAME.test(skillName) ||
    skillName.length > MAX_INSTALL_SKILL_NAME_LENGTH
  ) {
    throw new Error(
      `Invalid skill name "${value}". Use lowercase letters, numbers, dashes, optional colon namespaces, and at most ${MAX_INSTALL_SKILL_NAME_LENGTH} characters.`,
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
    const markdown = await getFsImplementation().readFile(
      join(sourcePath, 'SKILL.md'),
      { encoding: 'utf8' },
    )
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
  const fs = getFsImplementation()
  const tempRoot = await fs.mkdtemp(join(tmpdir(), 'openclaude-skill-install-'))
  try {
    const tempDir = resolveSkillInstallPath(tempRoot, skillName)
    await fs.mkdir(tempDir)
    await fs.writeFile(join(tempDir, 'SKILL.md'), markdown, {
      encoding: 'utf8',
    })
    if (registryEntry) {
      await fs.writeFile(
        join(tempDir, 'skill.json'),
        `${JSON.stringify(registryMetadata(registryEntry), null, 2)}\n`,
        { encoding: 'utf8' },
      )
    }
    return { tempRoot, tempDir, skillName }
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true })
    throw error
  }
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
  registryBacked: boolean
}> {
  if (!isUrl(spec) && (await pathExists(resolve(spec)))) {
    const fs = getFsImplementation()
    const sourcePath = resolve(spec)
    const sourceStats = await fs.stat(sourcePath)
    if (sourceStats.isDirectory()) {
      const skillName = normalizeInstallSkillName(
        await getSkillNameFromDirectory(sourcePath),
      )
      const tempRoot = await fs.mkdtemp(join(tmpdir(), 'openclaude-skill-install-'))
      try {
        const tempDir = resolveSkillInstallPath(tempRoot, skillName)
        await fs.cp(sourcePath, tempDir, {
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
          registryBacked: false,
        }
      } catch (error) {
        await fs.rm(tempRoot, { recursive: true, force: true })
        throw error
      }
    }

    const markdown = await fs.readFile(sourcePath, { encoding: 'utf8' })
    const fallbackName = skillNameFromSource(sourcePath)
    const prepared = await prepareSkillFromMarkdown({ markdown, fallbackName })
    return {
      ...prepared,
      sourceDescription: getDisplayPath(sourcePath),
      trust: 'local',
      toolsRequired: [],
      registryBacked: false,
    }
  }

  if (isUrl(spec)) {
    const url = new URL(spec)
    const expectedSha256 =
      url.protocol === 'http:' || url.protocol === 'https:'
        ? normalizeExpectedSha256(options.sha256)
        : null
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !expectedSha256
    ) {
      throw new Error(
        'Direct HTTP(S) skill installs require --sha256 to pin the expected SKILL.md digest.',
      )
    }
    const markdown = await readSourceText(spec)
    if (expectedSha256) {
      assertSha256Matches(markdown, expectedSha256, spec)
    }
    const fallbackName = skillNameFromSource(url.pathname)
    const prepared = await prepareSkillFromMarkdown({ markdown, fallbackName })
    return {
      ...prepared,
      sourceDescription: spec,
      trust: 'url',
      toolsRequired: [],
      registryBacked: false,
    }
  }

  const registryMatch = await resolveRegistryEntry(spec, options)
  const entry = registryMatch?.entry
  if (!entry || typeof entry.source !== 'string') {
    throw new Error(`Skill "${spec}" was not found in the registry.`)
  }

  const expectedSha256 = requireRegistrySha256(entry, spec)
  const minOpenClaudeVersion = assertCompatibleOpenClaudeVersion(entry, spec)
  const entrySource = resolveRegistryEntrySource(
    entry.source,
    registryMatch.registrySource,
  )
  const markdown = await readSourceText(entrySource)
  assertSha256Matches(markdown, expectedSha256, spec)

  const fallbackName =
    typeof entry.name === 'string' ? entry.name : skillNameFromSource(entrySource)
  const prepared = await prepareSkillFromMarkdown({
    markdown,
    fallbackName,
    registryEntry: entry,
  })
  return {
    ...prepared,
    sourceDescription: entrySource,
    trust: typeof entry.trust === 'string' ? entry.trust : 'registry',
    toolsRequired: stringArray(entry.tools_required),
    minOpenClaudeVersion,
    registryBacked: true,
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
    const installErrors = await validateSkillPath(candidate.tempDir, {
      requireRegistryMetadata: candidate.registryBacked,
    })
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

    const fs = getFsImplementation()
    await fs.mkdir(root)
    if (options.force) {
      await fs.rm(targetDir, { recursive: true, force: true })
    }
    await fs.cp(candidate.tempDir, targetDir, {
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
      await getFsImplementation().rm(candidate.tempRoot, {
        recursive: true,
        force: true,
      })
    }
  }
}
