// This file represents useful wrappers over node:child_process
// These wrappers ease error handling and cross-platform compatbility
// By using execa, Windows automatically gets shell escaping + BAT / CMD handling

import { type ExecaError, execa } from 'execa'
import path from 'node:path'
import { getCwd } from '../utils/cwd.js'
import { logError } from './log.js'

export { execSyncWithDefaults_DEPRECATED } from './execFileNoThrowPortable.js'

const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60

type ExecFileOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  // Setting useCwd=false avoids circular dependencies during initialization
  // getCwd() -> PersistentShell -> logEvent() -> execFileNoThrow
  useCwd?: boolean
  env?: NodeJS.ProcessEnv
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
}

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    useCwd: true,
  },
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return execFileNoThrowWithCwd(file, args, {
    abortSignal: options.abortSignal,
    timeout: options.timeout,
    preserveOutputOnError: options.preserveOutputOnError,
    cwd: options.useCwd ? getCwd() : undefined,
    env: options.env,
    stdin: options.stdin,
    input: options.input,
  })
}

type ExecFileWithCwdOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  maxBuffer?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
}

type ExecaResultWithError = {
  shortMessage?: string
  signal?: string
}

const CONTROL_CHAR_PATTERN = /[\0\r\n]/
const SAFE_BARE_EXECUTABLE_PATTERN = /^[A-Za-z0-9_.-]+$/

function hasPathSyntax(value: string): boolean {
  return value.includes(path.sep) || value.includes('/') || path.isAbsolute(value)
}

function validateExecutable(file: string): string | null {
  const normalized = file.trim()
  if (!normalized) {
    return 'Unsafe executable: empty command'
  }
  if (CONTROL_CHAR_PATTERN.test(normalized)) {
    return 'Unsafe executable: control characters are not allowed'
  }
  if (!hasPathSyntax(normalized) && !SAFE_BARE_EXECUTABLE_PATTERN.test(normalized)) {
    return 'Unsafe executable: bare command names may only contain letters, numbers, ".", "_" and "-"'
  }
  return null
}

function validateArgs(args: string[]): string | null {
  for (const arg of args) {
    if (CONTROL_CHAR_PATTERN.test(arg)) {
      return 'Unsafe argument: control characters are not allowed'
    }
  }
  return null
}

function validateWorkingDirectory(cwd: string | undefined): string | null {
  if (!cwd) {
    return null
  }
  if (CONTROL_CHAR_PATTERN.test(cwd)) {
    return 'Unsafe working directory: control characters are not allowed'
  }
  return null
}

/**
 * Extracts a human-readable error message from an execa result.
 *
 * Priority order:
 * 1. shortMessage - execa's human-readable error (e.g., "Command failed with exit code 1: ...")
 *    This is preferred because it already includes signal info when a process is killed,
 *    making it more informative than just the signal name.
 * 2. signal - the signal that killed the process (e.g., "SIGTERM")
 * 3. errorCode - fallback to just the numeric exit code
 */
function getErrorMessage(
  result: ExecaResultWithError,
  errorCode: number,
): string {
  if (result.shortMessage) {
    return result.shortMessage
  }
  if (typeof result.signal === 'string') {
    return result.signal
  }
  return String(errorCode)
}

/**
 * execFile, but always resolves (never throws)
 */
export function execFileNoThrowWithCwd(
  file: string,
  args: string[],
  {
    abortSignal,
    timeout: finalTimeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: finalPreserveOutput = true,
    cwd: finalCwd,
    env: finalEnv,
    maxBuffer,
    stdin: finalStdin,
    input: finalInput,
  }: ExecFileWithCwdOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    maxBuffer: 1_000_000,
  },
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  const executableError = validateExecutable(file)
  if (executableError) {
    return Promise.resolve({ stdout: '', stderr: '', code: 1, error: executableError })
  }

  const argsError = validateArgs(args)
  if (argsError) {
    return Promise.resolve({ stdout: '', stderr: '', code: 1, error: argsError })
  }

  const cwdError = validateWorkingDirectory(finalCwd)
  if (cwdError) {
    return Promise.resolve({ stdout: '', stderr: '', code: 1, error: cwdError })
  }

  return new Promise(resolve => {
    // Use execa for cross-platform .bat/.cmd compatibility on Windows
    execa(file, args, {
      maxBuffer,
      cancelSignal: abortSignal,
      timeout: finalTimeout,
      cwd: finalCwd,
      env: finalEnv,
      shell: false,
      stdin: finalStdin,
      input: finalInput,
      reject: false, // Don't throw on non-zero exit codes
    })
      .then(result => {
        if (result.failed) {
          if (finalPreserveOutput) {
            const errorCode = result.exitCode ?? 1
            void resolve({
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              code: errorCode,
              error: getErrorMessage(
                result as unknown as ExecaResultWithError,
                errorCode,
              ),
            })
          } else {
            void resolve({ stdout: '', stderr: '', code: result.exitCode ?? 1 })
          }
        } else {
          void resolve({
            stdout: result.stdout,
            stderr: result.stderr,
            code: 0,
          })
        }
      })
      .catch((error: ExecaError) => {
        logError(error)
        void resolve({ stdout: '', stderr: '', code: 1 })
      })
  })
}
