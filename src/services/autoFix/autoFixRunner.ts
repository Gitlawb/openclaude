import { spawn } from 'child_process'

export interface AutoFixCheckOptions {
  lint?: string
  test?: string
  timeout: number
  cwd: string
  signal?: AbortSignal
}

export interface AutoFixResult {
  hasErrors: boolean
  lintOutput?: string
  lintExitCode?: number
  testOutput?: string
  testExitCode?: number
  timedOut?: boolean
  errorSummary?: string
}

async function runCommand(
  command: string,
  cwd: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ stdout: '', stderr: 'Aborted', exitCode: 1, timedOut: false })
      return
    }

    let timedOut = false
    let stdout = ''
    let stderr = ''

    const isWindows = process.platform === 'win32'
    const proc = spawn(command, [], {
      cwd,
      env: { ...process.env },
      shell: true,
      windowsHide: true,
      // On Unix, create a process group so we can kill child processes on timeout/abort
      detached: !isWindows,
    })

    const killTree = () => {
      try {
        if (isWindows && proc.pid) {
          // shell=true on Windows can leave child commands running unless we
          // terminate the full process tree.
          const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.unref()
          return
        }

        if (proc.pid) {
          // Kill the entire process group
          process.kill(-proc.pid, 'SIGTERM')
          return
        }

        proc.kill('SIGTERM')
      } catch {
        // Process may have already exited; fallback to direct child kill.
        try {
          proc.kill('SIGTERM')
        } catch {
          // Ignore final fallback errors.
        }
      }
    }

    const onAbort = () => {
      killTree()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        stdout: stdout.slice(0, 10000),
        stderr: stderr.slice(0, 10000),
        exitCode: code ?? 1,
        timedOut,
      })
    })

    proc.on('error', () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        stdout,
        stderr: stderr || 'Command failed to start',
        exitCode: 1,
        timedOut: false,
      })
    })
  })
}

function buildErrorSummary(result: AutoFixResult): string | undefined {
  if (!result.hasErrors) return undefined
  const parts: string[] = []

  if (result.timedOut) {
    parts.push('Command timed out.')
  }
  if (result.lintExitCode !== undefined && result.lintExitCode !== 0) {
    parts.push(`Lint errors (exit code ${result.lintExitCode}):\n${result.lintOutput ?? ''}`)
  }
  if (result.testExitCode !== undefined && result.testExitCode !== 0) {
    parts.push(`Test failures (exit code ${result.testExitCode}):\n${result.testOutput ?? ''}`)
  }

  return parts.join('\n\n')
}

export async function runAutoFixCheck(
  options: AutoFixCheckOptions,
): Promise<AutoFixResult> {
  const { lint, test, timeout, cwd, signal } = options

  if (!lint && !test) {
    return { hasErrors: false }
  }

  if (signal?.aborted) {
    return { hasErrors: false }
  }

  const result: AutoFixResult = { hasErrors: false }

  // Run lint first
  if (lint) {
    const lintResult = await runCommand(lint, cwd, timeout, signal)
    result.lintOutput = (lintResult.stdout + '\n' + lintResult.stderr).trim()
    result.lintExitCode = lintResult.exitCode

    if (lintResult.timedOut) {
      result.hasErrors = true
      result.timedOut = true
      result.errorSummary = buildErrorSummary(result)
      return result
    }

    if (lintResult.exitCode !== 0) {
      result.hasErrors = true
      result.errorSummary = buildErrorSummary(result)
      return result
    }
  }

  // Run tests only if lint passed (or no lint configured)
  if (test) {
    const testResult = await runCommand(test, cwd, timeout, signal)
    result.testOutput = (testResult.stdout + '\n' + testResult.stderr).trim()
    result.testExitCode = testResult.exitCode

    if (testResult.timedOut) {
      result.hasErrors = true
      result.timedOut = true
    } else if (testResult.exitCode !== 0) {
      result.hasErrors = true
    }
  }

  result.errorSummary = buildErrorSummary(result)
  return result
}
