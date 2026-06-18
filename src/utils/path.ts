import { homedir } from 'os'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'path'
import { getCwd } from './cwd.js'
import { getFsImplementation } from './fsOperations.js'
import { getPlatform } from './platform.js'
import { posixPathToWindowsPath } from './windowsPaths.js'

/**
 * Expands a path that may contain tilde notation (~) to an absolute path.
 *
 * On Windows, POSIX-style paths (e.g., `/c/Users/...`) are automatically converted
 * to Windows format (e.g., `C:\Users\...`). The function always returns paths in
 * the native format for the current platform.
 *
 * @param path - The path to expand, may contain:
 *   - `~` - expands to user's home directory
 *   - `~/path` - expands to path within user's home directory
 *   - absolute paths - returned normalized
 *   - relative paths - resolved relative to baseDir
 *   - POSIX paths on Windows - converted to Windows format
 * @param baseDir - The base directory for resolving relative paths (defaults to current working directory)
 * @returns The expanded absolute path in the native format for the current platform
 *
 * @throws {Error} If path is invalid
 *
 * @example
 * expandPath('~') // '/home/user'
 * expandPath('~/Documents') // '/home/user/Documents'
 * expandPath('./src', '/project') // '/project/src'
 * expandPath('/absolute/path') // '/absolute/path'
 */
export function expandPath(path: string, baseDir?: string): string {
  // Set default baseDir to getCwd() if not provided
  const actualBaseDir = baseDir ?? getCwd() ?? getFsImplementation().cwd()

  // Input validation
  if (typeof path !== 'string') {
    throw new TypeError(`Path must be a string, received ${typeof path}`)
  }

  if (typeof actualBaseDir !== 'string') {
    throw new TypeError(
      `Base directory must be a string, received ${typeof actualBaseDir}`,
    )
  }

  // Security: Check for null bytes
  if (path.includes('\0') || actualBaseDir.includes('\0')) {
    throw new Error('Path contains null bytes')
  }

  // Handle empty or whitespace-only paths
  const trimmedPath = path.trim()
  if (!trimmedPath) {
    return normalize(actualBaseDir).normalize('NFC')
  }

  // Handle home directory notation
  if (trimmedPath === '~') {
    return homedir().normalize('NFC')
  }

  if (trimmedPath.startsWith('~/')) {
    return join(homedir(), trimmedPath.slice(2)).normalize('NFC')
  }

  // On Windows, convert POSIX-style paths (e.g., /c/Users/...) to Windows format
  let processedPath = trimmedPath
  if (getPlatform() === 'windows' && trimmedPath.match(/^\/[a-z]\//i)) {
    try {
      processedPath = posixPathToWindowsPath(trimmedPath)
    } catch {
      // If conversion fails, use original path
      processedPath = trimmedPath
    }
  }

  // Handle absolute paths
  if (isAbsolute(processedPath)) {
    return normalize(processedPath).normalize('NFC')
  }

  // Handle relative paths
  return resolve(actualBaseDir, processedPath).normalize('NFC')
}

/**
 * Converts an absolute path to a relative path from cwd, to save tokens in
 * tool output. If the path is outside cwd (relative path would start with ..),
 * returns the absolute path unchanged so it stays unambiguous.
 *
 * @param absolutePath - The absolute path to relativize
 * @returns Relative path if under cwd, otherwise the original absolute path
 */
export function toRelativePath(absolutePath: string): string {
  const relativePath = relative(getCwd(), absolutePath)
  // If the relative path would go outside cwd (starts with ..), keep absolute
  return relativePath.startsWith('..') ? absolutePath : relativePath
}

/**
 * Relativizes the file-path portion of a ripgrep content-mode line.
 *
 * ripgrep separates the path from the rest with `:` on a MATCH row and with `-`
 * on a CONTEXT row (`-A`/`-B`/`-C`/`context`). With line numbers (rg `-n`, the
 * default in GrepTool) the boundary is `<sep><line><sep>` — `:<n>:` for matches
 * and `-<n>-` for context rows. Finding that boundary is complicated on Windows
 * because an absolute path both begins with a drive-letter colon (`C:\...`) and
 * may contain `-` inside file/dir names, so neither the first `:` nor the first
 * `-` is reliable on its own.
 *
 * We therefore look (after any drive prefix) for the first `:<digits>:`, which a
 * Windows path can never contain since it has no non-drive colon — so this is
 * unambiguous for match rows even when the filename holds date-like `-2024-`
 * runs. Only if that is absent do we fall back to the first `-<digits>-` for
 * context rows, then to the first colon for line-number-less match rows
 * (`path:content`). POSIX paths (no drive letter) are handled the same way.
 *
 * @param line - A single ripgrep content line (match or context row)
 * @param relativize - Function that converts an absolute path to a relative one
 *   (defaults to {@link toRelativePath}; injectable for deterministic tests)
 * @returns The line with its leading path made relative, or unchanged when no
 *   path/content boundary can be located
 */
export function relativizeContentLine(
  line: string,
  relativize: (p: string) => string = toRelativePath,
): string {
  // Skip a leading Windows drive-letter colon (`C:`) so it is not mistaken for
  // the path/content separator. driveOffset stays 0 for POSIX paths.
  const driveOffset = /^[A-Za-z]:/.test(line) ? 2 : 0
  const afterDrive = line.slice(driveOffset)

  // Prefer the `:<digits>:` match boundary (unambiguous: paths have no non-drive
  // colon), then the `-<digits>-` context boundary.
  const numbered = afterDrive.match(/:\d+:/) ?? afterDrive.match(/-\d+-/)
  const boundary =
    numbered?.index !== undefined
      ? driveOffset + numbered.index
      : // Line-number-less match row (`path:content`): fall back to first colon.
        line.indexOf(':', driveOffset)
  if (boundary > 0) {
    return relativize(line.slice(0, boundary)) + line.slice(boundary)
  }
  return line
}

/**
 * Gets the directory path for a given file or directory path.
 * If the path is a directory, returns the path itself.
 * If the path is a file or doesn't exist, returns the parent directory.
 *
 * @param path - The file or directory path
 * @returns The directory path
 */
export function getDirectoryForPath(path: string): string {
  const absolutePath = expandPath(path)
  // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
  if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
    return dirname(absolutePath)
  }
  try {
    const stats = getFsImplementation().statSync(absolutePath)
    if (stats.isDirectory()) {
      return absolutePath
    }
  } catch {
    // Path doesn't exist or can't be accessed
  }
  // If it's not a directory or doesn't exist, return the parent directory
  return dirname(absolutePath)
}

/**
 * Checks if a path contains directory traversal patterns that navigate to parent directories.
 *
 * @param path - The path to check for traversal patterns
 * @returns true if the path contains traversal (e.g., '../', '..\', or ends with '..')
 */
export function containsPathTraversal(path: string): boolean {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)
}

// Re-export from the shared zero-dep source.
export { sanitizePath } from './sessionStoragePortable.js'

/**
 * Normalizes a path for use as a JSON config key.
 * On Windows, paths can have inconsistent separators (C:\path vs C:/path)
 * depending on whether they come from git, Node.js APIs, or user input.
 * This normalizes to forward slashes for consistent JSON serialization.
 *
 * @param path - The path to normalize
 * @returns The normalized path with consistent forward slashes
 */
export function normalizePathForConfigKey(path: string): string {
  // First use Node's normalize to resolve . and .. segments
  const normalized = normalize(path)
  // Then convert all backslashes to forward slashes for consistent JSON keys
  // This is safe because forward slashes work in Windows paths for most operations
  return normalized.replace(/\\/g, '/')
}
