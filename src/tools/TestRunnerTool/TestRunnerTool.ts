import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionResult } from '../../types/permissions.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { TEST_RUNNER_TOOL_NAME } from './constants.js'
import { getDescription } from './prompt.js'
import { getToolUseSummary, renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .describe(
        'The test command to run (e.g., "npm test", "pytest", "go test ./...", "cargo test"). If omitted, auto-detects from project files.',
      )
      .optional(),
    args: z
      .string()
      .optional()
      .describe(
        'Additional arguments to pass to the test command (e.g., "--verbose", "-k test_login", "--run specific_test").',
      ),
    pattern: z
      .string()
      .optional()
      .describe(
        'Filter tests by name pattern (e.g., "login", "UserModel"). Works with most frameworks.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type TestFailure = {
  name: string
  file?: string
  error?: string
}

type TestResult = {
  framework: string
  totalTests: number
  passed: number
  failed: number
  skipped: number
  duration: string
  failures: TestFailure[]
  command: string
  rawOutput: string
}

const outputSchema = lazySchema(() =>
  z.object({
    framework: z.string(),
    totalTests: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    duration: z.string(),
    failures: z.array(z.object({
      name: z.string(),
      file: z.string().optional(),
      error: z.string().optional(),
    })),
    command: z.string(),
    rawOutput: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function detectTestCommand(): string | null {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const cwd = getCwd()

  const checks: Array<{ file: string; cmd: string }> = [
    { file: 'package.json', cmd: 'npm test' },
    { file: 'Cargo.toml', cmd: 'cargo test' },
    { file: 'go.mod', cmd: 'go test ./...' },
    { file: 'pytest.ini', cmd: 'pytest' },
    { file: 'pyproject.toml', cmd: 'pytest' },
    { file: 'setup.cfg', cmd: 'pytest' },
    { file: 'Makefile', cmd: 'make test' },
  ]

  for (const check of checks) {
    if (fs.existsSync(path.join(cwd, check.file))) {
      // For package.json, verify "test" script exists
      if (check.file === 'package.json') {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
          if (pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
            return check.cmd
          }
        } catch {
          // Fall through
        }
      } else {
        return check.cmd
      }
    }
  }
  return null
}

function parseTestOutput(output: string, command: string): TestResult {
  const lines = output.split('\n')

  let framework = 'unknown'
  let totalTests = 0
  let passed = 0
  let failed = 0
  let skipped = 0
  let duration = 'unknown'
  const failures: TestFailure[] = []

  // Detect framework from output patterns
  if (output.includes('PASS ') || output.includes('FAIL ') || output.includes('Tests:')) {
    framework = command.includes('vitest') ? 'vitest' : command.includes('jest') ? 'jest' : 'jest-compatible'
  } else if (output.includes('====') && (output.includes('PASSED') || output.includes('FAILED'))) {
    framework = 'pytest'
  } else if (output.includes('--- FAIL') || output.includes('--- PASS') || output.includes('ok\t') || output.includes('FAIL\t')) {
    framework = 'go test'
  } else if (output.includes('test result:') && output.includes('passed')) {
    framework = 'cargo test'
  } else if (command.includes('pytest')) {
    framework = 'pytest'
  } else if (command.includes('cargo')) {
    framework = 'cargo test'
  } else if (command.includes('go test')) {
    framework = 'go test'
  }

  // Parse based on detected framework
  if (framework.startsWith('jest') || framework === 'vitest') {
    // Jest/Vitest: "Tests: 2 failed, 5 passed, 7 total"
    for (const line of lines) {
      const testMatch = line.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/)
      if (testMatch) {
        failed = parseInt(testMatch[1] || '0', 10)
        skipped = parseInt(testMatch[2] || '0', 10)
        passed = parseInt(testMatch[3] || '0', 10)
        totalTests = parseInt(testMatch[4], 10)
      }
      const timeMatch = line.match(/Time:\s+([\d.]+\s*\w+)/)
      if (timeMatch) duration = timeMatch[1]

      // Collect FAIL blocks
      const failMatch = line.match(/^\s*(?:✕|×|✗|FAIL)\s+(.+?)(?:\s+\((\d+(?:\.\d+)?)\s*(?:ms|s)\))?$/)
      if (failMatch) {
        failures.push({ name: failMatch[1].trim() })
      }
    }
  } else if (framework === 'pytest') {
    // Pytest: "=== 5 passed, 2 failed in 0.12s ==="
    for (const line of lines) {
      const summaryMatch = line.match(/=+\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+error,?\s*)?in\s+([\d.]+)s/)
      if (summaryMatch) {
        failed = parseInt(summaryMatch[1] || '0', 10)
        passed = parseInt(summaryMatch[2] || '0', 10)
        skipped = parseInt(summaryMatch[3] || '0', 10)
        totalTests = failed + passed + skipped
        duration = `${summaryMatch[5]}s`
      }
      // Collect FAILURES section
      const failHeader = line.match(/^FAILURES\s/)
      const testNameMatch = line.match(/^(?:FAILED\s+)?(\S+::\S+)/)
      if (testNameMatch && !failHeader) {
        failures.push({ name: testNameMatch[1] })
      }
    }
  } else if (framework === 'go test') {
    // Go: "--- FAIL: TestLogin (0.00s)" and "FAIL\tok\tpackage/path\t0.123s"
    for (const line of lines) {
      const failMatch = line.match(/^--- FAIL:\s+(\S+)\s+\((\d+\.\d+)s\)/)
      if (failMatch) {
        failures.push({ name: failMatch[1] })
      }
      const summaryMatch = line.match(/^(?:ok|FAIL)\s+\S+\s+([\d.]+)s/)
      if (summaryMatch) duration = `${summaryMatch[1]}s`
    }
    // Count from final summary
    const passCount = (output.match(/--- PASS:/g) || []).length
    const failCount = (output.match(/--- FAIL:/g) || []).length
    passed = passCount
    failed = failCount
    totalTests = passed + failed
  } else if (framework === 'cargo test') {
    // Cargo: "test result: FAILED. 3 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out"
    for (const line of lines) {
      const resultMatch = line.match(/test result:\s+\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored/)
      if (resultMatch) {
        passed = parseInt(resultMatch[1], 10)
        failed = parseInt(resultMatch[2], 10)
        skipped = parseInt(resultMatch[3], 10)
        totalTests = passed + failed + skipped
      }
      const failMatch = line.match(/^test\s+(\S+)\s+\.\.\.\s+FAILED/)
      if (failMatch) {
        failures.push({ name: failMatch[1] })
      }
      const timeMatch = line.match(/finished in\s+([\d.]+)/)
      if (timeMatch) duration = `${timeMatch[1]}s`
    }
  }

  // Fallback: try to parse any "X passed, Y failed" pattern
  if (totalTests === 0) {
    const genericMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/i)
    if (genericMatch) {
      passed = parseInt(genericMatch[1], 10)
      failed = parseInt(genericMatch[2], 10)
      totalTests = passed + failed
    }
  }

  // Check exit code pattern
  if (totalTests === 0) {
    const exitMatch = output.match(/exit code[:\s]+(\d+)/i)
    if (exitMatch) {
      const exitCode = parseInt(exitMatch[1], 10)
      if (exitCode === 0) {
        passed = 1
        totalTests = 1
      } else {
        failed = 1
        totalTests = 1
      }
    }
  }

  return {
    framework,
    totalTests,
    passed,
    failed,
    skipped,
    duration,
    failures,
    command,
    rawOutput: output,
  }
}

async function executeTestCommand(command: string, args?: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { spawn } = require('child_process') as typeof import('child_process')
  const cwd = getCwd()

  const fullCmd = args ? `${command} ${args.join(' ')}` : command
  const parts = fullCmd.split(/\s+/)
  const cmd = parts[0]!
  const cmdArgs = parts.slice(1)

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, {
      cwd,
      shell: true,
      signal,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
    proc.on('error', (err: Error) => {
      if (err.name === 'AbortError') {
        reject(err)
      } else {
        resolve({ stdout, stderr: err.message, exitCode: 1 })
      }
    })
  })
}

export const TestRunnerTool = buildTool({
  name: TEST_RUNNER_TOOL_NAME,
  maxResultSizeChars: 30_000,
  strict: true,
  async description() {
    return getDescription()
  },
  userFacingName() {
    return 'Test Runner'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Running tests: ${summary}` : 'Running tests'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isDestructive() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.command || 'auto-detect'
  },
  async validateInput({ command }): Promise<ValidationResult> {
    return { result: true }
  },
  async checkPermissions(input, context): Promise<PermissionResult> {
    return { behavior: 'ask', message: `Run test command: ${input.command || 'auto-detect'}${input.args ? ` ${input.args}` : ''}` }
  },
  async prompt() {
    return getDescription()
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { framework, totalTests, passed, failed, skipped, duration, failures, command, rawOutput } = output
    const maxLines = 200
    const outputLines = rawOutput.split('\n')
    const truncatedOutput = outputLines.length > maxLines
      ? outputLines.slice(0, maxLines).join('\n') + `\n... (${outputLines.length - maxLines} more lines)`
      : rawOutput

    let summary = `Test Results (${framework}):\n`
    summary += `  Total: ${totalTests} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}\n`
    summary += `  Duration: ${duration}\n`
    summary += `  Command: ${command}\n`

    if (failures.length > 0) {
      summary += `\nFailures:\n`
      for (const f of failures) {
        summary += `  ✕ ${f.name}${f.file ? ` (${f.file})` : ''}${f.error ? `\n    ${f.error}` : ''}\n`
      }
    }

    summary += `\n--- Raw Output ---\n${truncatedOutput}`

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: summary,
    }
  },
  async call({ command, args, pattern, maxOutputLines }, { abortController }) {
    let testCommand = command || detectTestCommand()
    if (!testCommand) {
      return {
        data: {
          framework: 'unknown',
          totalTests: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: '0s',
          failures: [],
          command: '',
          rawOutput: 'No test command specified and could not auto-detect test framework. Please provide a command.',
        },
      }
    }

    const cmdArgs: string[] = []
    if (args) cmdArgs.push(...args.split(/\s+/))
    if (pattern) {
      // Add pattern filter based on framework
      if (testCommand.includes('pytest')) {
        cmdArgs.push('-k', pattern)
      } else if (testCommand.includes('go test')) {
        cmdArgs.push('-run', pattern)
      } else if (testCommand.includes('cargo')) {
        cmdArgs.push(pattern)
      } else {
        // Jest/Vitest: pass as --testNamePattern
        cmdArgs.push('--testNamePattern', pattern)
      }
    }

    try {
      const { stdout, stderr, exitCode } = await executeTestCommand(
        testCommand,
        cmdArgs.length > 0 ? cmdArgs : undefined,
        abortController.signal,
      )

      const combinedOutput = stdout + (stderr ? `\n${stderr}` : '')
      const result = parseTestOutput(combinedOutput, testCommand)

      return { data: result }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }
      return {
        data: {
          framework: 'unknown',
          totalTests: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: '0s',
          failures: [],
          command: testCommand,
          rawOutput: `Error executing test command: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
