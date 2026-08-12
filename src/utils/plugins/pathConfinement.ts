import { realpathSync } from 'fs'
import { resolve, sep } from 'path'

/** Resolve a path lexically and require it to stay within the base directory. */
export function resolvePathWithinBase(
  basePath: string,
  relativePath: string,
): string {
  const resolvedPath = resolve(basePath, relativePath)
  const resolvedBase = resolve(basePath)
  const resolvedBasePrefix = resolvedBase.endsWith(sep)
    ? resolvedBase
    : resolvedBase + sep
  if (
    !resolvedPath.startsWith(resolvedBasePrefix) &&
    resolvedPath !== resolvedBase
  ) {
    throw new Error(
      `Path traversal detected: "${relativePath}" would escape the base directory`,
    )
  }
  return resolvedPath
}

/** Resolve an existing relative path and require its canonical target to stay in base. */
export function validatePathWithinBase(
  basePath: string,
  relativePath: string,
): string {
  const resolvedPath = resolvePathWithinBase(basePath, relativePath)

  const canonicalBase = realpathSync(basePath)
  const canonicalPath = realpathSync(resolvedPath)
  const canonicalBasePrefix = canonicalBase.endsWith(sep)
    ? canonicalBase
    : canonicalBase + sep
  if (
    !canonicalPath.startsWith(canonicalBasePrefix) &&
    canonicalPath !== canonicalBase
  ) {
    throw new Error(
      `Path traversal detected: "${relativePath}" would escape the base directory`,
    )
  }

  return canonicalPath
}
