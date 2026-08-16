import { realpathSync } from 'fs'
import { resolve, sep } from 'path'
import { getFsImplementation } from '../fsOperations.js'

type PathConfinementOptions = {
  allowBase?: boolean
  /** Test-only override for the filesystem case-sensitivity probe. */
  caseInsensitive?: boolean
}

const caseInsensitiveFsCache = new Map<string, boolean>()

function flipLastAlphaCase(path: string): string {
  for (let index = path.length - 1; index >= 0; index--) {
    const character = path[index]!
    const lower = character.toLowerCase()
    const upper = character.toUpperCase()
    if (lower !== upper) {
      return (
        path.slice(0, index) +
        (character === upper ? lower : upper) +
        path.slice(index + 1)
      )
    }
  }
  return path
}

export function isCaseInsensitiveFsAt(directory: string): boolean {
  if (process.platform === 'win32') return true
  const key = resolve(directory)
  const cached = caseInsensitiveFsCache.get(key)
  if (cached !== undefined) return cached
  let result = false
  try {
    const flipped = flipLastAlphaCase(key)
    if (flipped !== key) {
      const fs = getFsImplementation()
      const original = fs.statSync(key)
      const alternate = fs.statSync(flipped)
      result = original.ino === alternate.ino && original.dev === alternate.dev
    }
  } catch {
    result = false
  }
  caseInsensitiveFsCache.set(key, result)
  return result
}

export function pathsEqualForFs(
  left: string,
  right: string,
  probeDirectory: string,
): boolean {
  return isCaseInsensitiveFsAt(probeDirectory)
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

export function clearCaseInsensitiveFsCacheForTesting(): void {
  caseInsensitiveFsCache.clear()
}

function isPathWithinBase(
  candidate: string,
  base: string,
  options: PathConfinementOptions,
): boolean {
  const caseInsensitive = options.caseInsensitive ?? isCaseInsensitiveFsAt(base)
  const comparableCandidate = caseInsensitive
    ? candidate.toLowerCase()
    : candidate
  const comparableBase = caseInsensitive ? base.toLowerCase() : base
  const basePrefix = comparableBase.endsWith(sep)
    ? comparableBase
    : comparableBase + sep
  return (
    comparableCandidate.startsWith(basePrefix) ||
    (options.allowBase !== false && comparableCandidate === comparableBase)
  )
}

/** Resolve a path lexically and require it to stay within the base directory. */
export function resolvePathWithinBase(
  basePath: string,
  relativePath: string,
  options: PathConfinementOptions = {},
): string {
  const resolvedPath = resolve(basePath, relativePath)
  const resolvedBase = resolve(basePath)
  if (!isPathWithinBase(resolvedPath, resolvedBase, options)) {
    throw new Error(
      `Path traversal detected: "${relativePath}" would escape the base directory`,
    )
  }
  return resolvedPath
}

/**
 * Resolve an existing relative path and require its canonical target to stay
 * in base. Both the base and target must exist. Use `resolvePathWithinBase`
 * when the target may be absent and lexical confinement is sufficient.
 */
export function validatePathWithinBase(
  basePath: string,
  relativePath: string,
  options: PathConfinementOptions = {},
): string {
  const resolvedPath = resolvePathWithinBase(basePath, relativePath, options)

  const canonicalBase = realpathSync(basePath)
  const canonicalPath = realpathSync(resolvedPath)
  if (!isPathWithinBase(canonicalPath, canonicalBase, options)) {
    throw new Error(
      `Path traversal detected: "${relativePath}" would escape the base directory`,
    )
  }

  return canonicalPath
}
