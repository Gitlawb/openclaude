// This file represents useful wrappers over node:child_process
// These wrappers ease error handling and cross-platform compatibility.
// By using cross-spawn, Windows gets .cmd/.bat compatibility without falling
// back to a generic shell command string.

import { spawn } from 'cross-spawn'
import path from 'node:path'
import { getCwd } from '../utils/cwd.js'
import { logError } from './log.js'
import { CONTROL_CHAR_PATTERN } from './validation.js'

export { execSyncWithDefaults_DEPRECATED } from './execFileNoThrowPortable.js'

const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60
const DEFAULT_MAX_BUFFER = 1_000_000

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

type ProcessResultWithError = {
  signal?: string
}

const SAFE_BARE_EXECUTABLE_PATTERN = /^[A-Za-z0-9_.-]+$/

function hasPathSyntax(value: string): boolean {
  return (
    value.includes(path.sep) ||
    value.includes('/') ||
    path.isAbsolute(value)
  )
}

function validateExecutable(file: string): string | null {
  const normalized = file.trim()
  if (!normalized) {
    return 'Unsafe executable: empty command'
  }
  if (CONTROL_CHAR_PATTERN.test(normalized)) {
    return 'Unsafe executable: control characters are not allowed'
  }
  if (
    !hasPathSyntax(normalized) &&
    !SAFE_BARE_EXECUTABLE_PATTERN.test(normalized)
  ) {
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

function sanitizeEnvironment(
  env: NodeJS.ProcessEnv | undefined,
): { value?: NodeJS.ProcessEnv; error?: string } {
  if (!env) {
    return {}
  }

  for (const [key, value] of Object.entries(env)) {
    if (CONTROL_CHAR_PATTERN.test(key)) {
      return {
        error: 'Unsafe environment: control characters are not allowed in keys',
      }
    }
    if (typeof value === 'string' && CONTROL_CHAR_PATTERN.test(value)) {
      return {
        error:
          'Unsafe environment: control characters are not allowed in values',
      }
    }
  }

  return { value: env }
}

/**
 * Extracts a human-readable error message from a process result.
 *
 * Priority order:
 * 1. signal - the signal that killed the process (e.g., "SIGTERM")
 * 2. errorCode - fallback to just the numeric exit code
 */
function getErrorMessage(
  result: ProcessResultWithError,
  errorCode: number,
): string {
  if (typeof result.signal === 'string') {
    return result.signal
  }
  return String(errorCode)
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
    maxBuffer = DEFAULT_MAX_BUFFER,
    stdin: finalStdin,
    input: finalInput,
  }: ExecFileWithCwdOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    maxBuffer: DEFAULT_MAX_BUFFER,
  },
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  const executableError = validateExecutable(file)
  if (executableError) {
    return Promise.resolve({
      stdout: '',
      stderr: '',
      code: 1,
      error: executableError,
    })
  }

  const argsError = validateArgs(args)
  if (argsError) {
    return Promise.resolve({
      stdout: '',
      stderr: '',
      code: 1,
      error: argsError,
    })
  }

  const cwdError = validateWorkingDirectory(finalCwd)
  if (cwdError) {
    return Promise.resolve({
      stdout: '',
      stderr: '',
      code: 1,
      error: cwdError,
    })
  }

  const sanitizedEnv = sanitizeEnvironment(finalEnv)
  if (sanitizedEnv.error) {
    return Promise.resolve({
      stdout: '',
      stderr: '',
      code: 1,
      error: sanitizedEnv.error,
    })
  }

  return new Promise(resolve => {
    const stdinMode = finalInput !== undefined ? 'pipe' : finalStdin ?? 'pipe'
    const child = spawn(file, args, {
      cwd: finalCwd,
      env: sanitizedEnv.value,
      shell: false,
      signal: abortSignal,
      stdio: [stdinMode, 'pipe', 'pipe'],
    })

    let settled = false
    let stdout = ''
    let stderr = ''
    let combinedBufferSize = 0
    let signal: string | undefined
    let timedOut = false

    const finish = (result: {
      stdout: string
      stderr: string
      code: number
      error?: string
    }) => {
      if (settled) {
        return
      }
      settled = true
      void resolve(result)
    }

    const appendOutput = (
      chunk: string | Buffer,
      target: 'stdout' | 'stderr',
    ) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      combinedBufferSize += Buffer.byteLength(text, 'utf8')
      if (combinedBufferSize > maxBuffer) {
        child.kill()
        finish({
          stdout: finalPreserveOutput ? stdout : '',
          stderr: finalPreserveOutput ? stderr : '',
          code: 1,
          error: 'maxBuffer exceeded',
        })
        return
      }

      if (target === 'stdout') {
        stdout += text
      } else {
        stderr += text
      }
    }

    child.stdout?.on('data', chunk => appendOutput(chunk, 'stdout'))
    child.stderr?.on('data', chunk => appendOutput(chunk, 'stderr'))

    child.once('spawn', () => {
      if (stdinMode === 'pipe' && child.stdin) {
        if (finalInput !== undefined) {
          child.stdin.end(finalInput)
        } else {
          child.stdin.end()
        }
      }
    })

    child.once('error', error => {
      logError(error)
      finish({ stdout: '', stderr: '', code: 1, error: error.message })
    })

    const timeoutId =
      finalTimeout > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill()
          }, finalTimeout)
        : undefined

    child.once('close', (code, closeSignal) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      signal = closeSignal ?? undefined
      const errorCode = code ?? 1

      if (timedOut) {
        finish({
          stdout: finalPreserveOutput ? stdout : '',
          stderr: finalPreserveOutput ? stderr : '',
          code: errorCode,
          error: `Command timed out after ${finalTimeout}ms`,
        })
        return
      }

      if (errorCode !== 0) {
        if (finalPreserveOutput) {
          finish({
            stdout,
            stderr,
            code: errorCode,
            error: getErrorMessage({ signal }, errorCode),
          })
        } else {
          finish({ stdout: '', stderr: '', code: errorCode })
        }
        return
      }

      finish({
        stdout,
        stderr,
        code: 0,
      })
    })
  })
}
