/**
 * `openclaude skills verify`: checks every installed skill against the
 * registry's revocation list, then hands the content check to eyebrow
 * when that tool is installed. The client never re-hashes SKILL.md
 * itself; the lockfile and the drift verdict stay with eyebrow.
 */

import { spawn } from 'child_process'
import { delimiter, join, relative, resolve, sep } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getDisplayPath } from '../../utils/file.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { PROJECT_CONFIG_DIR_NAMES } from '../../utils/markdownConfigLoader.js'
import {
  readRevocations,
  resolveRegistrySource,
  resolveRevocationsSource,
  revocationApplies,
  type SkillRevocation,
} from './skillsInstall.js'

export type VerifyOptions = {
  projectDir?: string
  registry?: string
  lockfile?: string
  policy?: string
}

type InstalledSkill = {
  name: string
  dir: string
  id?: string
  version?: string
  sha256?: string
}

/**
 * Runs the eyebrow binary and resolves with its exit code. Replaced in
 * tests so the handler's argument building and exit code handling can be
 * checked without a real binary.
 */
export type EyebrowRunner = (
  binary: string,
  args: string[],
  cwd: string,
) => Promise<number>

const EYEBROW_BINARY_ENV = 'OPENCLAUDE_EYEBROW_BIN'
const DEFAULT_LOCKFILE_NAME = 'eyebrowlock.json'
const SHA256_HEX = /^[a-fA-F0-9]{64}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await getFsImplementation().stat(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await getFsImplementation().stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Reads the skill.json sidecar as written on disk. The digest is the
 * registry pin recorded at install, not a hash of the current files. A
 * skill with no sidecar, or one without an id or digest, carries nothing
 * a revocation entry can match.
 */
async function describeSkill(root: string, dir: string): Promise<InstalledSkill> {
  const skill: InstalledSkill = {
    name: relative(root, dir).split(sep).join(':'),
    dir,
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(
      await getFsImplementation().readFile(join(dir, 'skill.json'), {
        encoding: 'utf8',
      }),
    )
  } catch {
    return skill
  }
  if (!isPlainObject(parsed)) {
    return skill
  }
  if (typeof parsed.id === 'string' && parsed.id.trim() !== '') {
    skill.id = parsed.id
  }
  if (typeof parsed.version === 'string' && parsed.version.trim() !== '') {
    skill.version = parsed.version
  }
  if (typeof parsed.sha256 === 'string' && SHA256_HEX.test(parsed.sha256.trim())) {
    skill.sha256 = parsed.sha256.trim().toLowerCase()
  }
  return skill
}

/**
 * Finds skill directories under a skills root: a directory that holds
 * SKILL.md, nested to any depth, reached through symlinks too. Files
 * directly in the root are ignored, a directory below a found skill is
 * not searched, and a symlink loop stops at the first repeat.
 */
async function findInstalledSkills(root: string): Promise<InstalledSkill[]> {
  const fs = getFsImplementation()
  const found: InstalledSkill[] = []
  const visited = new Set<string>()

  async function walk(dir: string): Promise<void> {
    let realDir = dir
    try {
      realDir = fs.realpathSync(dir)
    } catch {
      return
    }
    if (visited.has(realDir)) {
      return
    }
    visited.add(realDir)

    let entries
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    if (entries.some(entry => entry.name === 'SKILL.md')) {
      found.push(await describeSkill(root, dir))
      return
    }
    for (const entry of entries) {
      const entryPath = join(dir, entry.name)
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(entryPath)))) {
        await walk(entryPath)
      }
    }
  }

  let topLevel
  try {
    topLevel = await fs.readdir(root)
  } catch {
    return []
  }
  for (const entry of topLevel) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(entryPath)))) {
      await walk(entryPath)
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name))
  return found
}

function skillRoots(projectDir: string): string[] {
  return [
    ...PROJECT_CONFIG_DIR_NAMES.map(configDirName =>
      join(projectDir, configDirName, 'skills'),
    ),
    join(getClaudeConfigHomeDir(), 'skills'),
  ]
}

function revocationReason(match: SkillRevocation): string {
  return typeof match.reason === 'string' && match.reason.trim() !== ''
    ? ` (${match.reason.trim()})`
    : ''
}

/**
 * Locates eyebrow: OPENCLAUDE_EYEBROW_BIN when set, otherwise the first
 * `eyebrow` executable on PATH. Returns undefined when neither exists, so
 * the caller can say so and stop instead of failing.
 */
async function findEyebrowBinary(): Promise<string | undefined> {
  const override = process.env[EYEBROW_BINARY_ENV]
  if (override && override.trim() !== '') {
    return override
  }
  const names =
    process.platform === 'win32'
      ? ['eyebrow.exe', 'eyebrow.cmd', 'eyebrow.bat', 'eyebrow']
      : ['eyebrow']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        if ((await getFsImplementation().stat(candidate)).isFile()) {
          return candidate
        }
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return undefined
}

const defaultEyebrowRunner: EyebrowRunner = (binary, args, cwd) =>
  new Promise((resolveExit, reject) => {
    const child = spawn(binary, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    // A signal kill leaves no exit code; report it as eyebrow's internal
    // error code rather than a clean run.
    child.once('close', code => resolveExit(code ?? 3))
  })

let eyebrowRunner: EyebrowRunner = defaultEyebrowRunner

export function setEyebrowRunnerForTesting(runner: EyebrowRunner | undefined): void {
  eyebrowRunner = runner ?? defaultEyebrowRunner
}

/**
 * Reports each installed skill's revocation state, then runs
 * `eyebrow verify` on the project when eyebrow and a lockfile exist.
 * Exit code: 1 when a skill is revoked or the revocation list cannot be
 * read; otherwise eyebrow's own exit code; 0 when nothing is wrong.
 */
export async function skillsVerifyHandler(options: VerifyOptions = {}): Promise<void> {
  const projectDir = resolve(options.projectDir ?? getCwd())
  const skills = (
    await Promise.all(skillRoots(projectDir).map(findInstalledSkills))
  ).flat()

  const registrySource = await resolveRegistrySource(options.registry)
  const revocationsSource = resolveRevocationsSource(registrySource)
  let revocations: SkillRevocation[]
  try {
    revocations = await readRevocations(registrySource)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  const width = Math.max(0, ...skills.map(skill => skill.name.length))
  const revoked: InstalledSkill[] = []
  console.log(
    `Found ${skills.length} installed skill${skills.length === 1 ? '' : 's'}. Revocation list: ${revocationsSource}`,
  )
  for (const skill of skills) {
    const label = skill.name.padEnd(width)
    if (skill.id === undefined && skill.sha256 === undefined) {
      console.log(`  ${label}  skipped (no registry metadata)`)
      continue
    }
    const match = revocations.find(entry =>
      revocationApplies(entry, {
        id: skill.id,
        version: skill.version,
        sha256: skill.sha256 ?? '',
      }),
    )
    if (match) {
      revoked.push(skill)
      console.log(`  ${label}  REVOKED${revocationReason(match)}`)
    } else {
      console.log(`  ${label}  ok`)
    }
  }
  if (revoked.length > 0) {
    console.error(
      `${revoked.length} revoked skill${revoked.length === 1 ? '' : 's'} installed. Remove with "openclaude skills remove <name>".`,
    )
    process.exitCode = 1
  }

  const binary = await findEyebrowBinary()
  if (!binary) {
    console.log(
      'eyebrow not found; install it to check skill contents against a lockfile (see docs/skills.md).',
    )
    return
  }
  // eyebrow runs inside the project with `--path .`, the form the guide
  // uses for `scan`: an artifact's id derives from the path it was found
  // under, so an absolute path here would report every skill as replaced.
  const lockfile = options.lockfile ?? DEFAULT_LOCKFILE_NAME
  if (!(await pathExists(resolve(projectDir, lockfile)))) {
    console.log(
      `eyebrow found but no lockfile at ${getDisplayPath(resolve(projectDir, lockfile))}. Run "eyebrow scan --path . --lockfile ${lockfile}" in ${getDisplayPath(projectDir)} first.`,
    )
    return
  }
  const args = ['verify', '--path', '.', '--lockfile', lockfile]
  if (options.policy) {
    args.push('--ci', '--policy', options.policy)
  }
  // Print the binary that runs: verify does not check its version, and an
  // eyebrow older than 0.4.4 has no OpenClaude discovery.
  console.log(`Running ${binary} ${args.join(' ')} in ${getDisplayPath(projectDir)}`)
  let exitCode: number
  try {
    exitCode = await eyebrowRunner(binary, args, projectDir)
  } catch (error) {
    console.error(
      `Failed to run eyebrow at ${binary}: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
    return
  }
  if (exitCode !== 0 && revoked.length === 0) {
    process.exitCode = exitCode
  }
}
