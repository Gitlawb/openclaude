import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionResult } from '../../types/permissions.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DEPENDENCY_TOOL_NAME } from './constants.js'
import { getDescription } from './prompt.js'
import { getToolUseSummary, renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .enum(['audit', 'outdated', 'graph', 'license', 'info'])
      .describe('The dependency analysis operation to perform.'),
    packageName: z
      .string()
      .optional()
      .describe('Package name for "info" operation.'),
    depth: z
      .number()
      .optional()
      .describe('Depth for dependency graph. Defaults to 2.'),
    production: z
      .boolean()
      .optional()
      .describe('Only show production dependencies (exclude devDependencies). Defaults to false.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type DepResult = {
  operation: string
  summary: string
  details: string
}

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    summary: z.string(),
    details: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

type PackageManager = 'npm' | 'cargo' | 'pip' | 'go'

function detectPackageManager(): PackageManager {
  const fs = require('fs') as typeof import('fs')
  const cwd = getCwd()

  if (fs.existsSync(`${cwd}/Cargo.toml`)) return 'cargo'
  if (fs.existsSync(`${cwd}/go.mod`)) return 'go'
  if (fs.existsSync(`${cwd}/requirements.txt`) || fs.existsSync(`${cwd}/pyproject.toml`) || fs.existsSync(`${cwd}/setup.py`)) return 'pip'
  return 'npm'
}

async function runCommand(cmd: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { spawn } = require('child_process') as typeof import('child_process')
  const cwd = getCwd()

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
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
      if (err.name === 'AbortError') reject(err)
      else resolve({ stdout: '', stderr: err.message, exitCode: 1 })
    })
  })
}

export const DependencyTool = buildTool({
  name: DEPENDENCY_TOOL_NAME,
  maxResultSizeChars: 30_000,
  strict: true,
  async description() {
    return getDescription()
  },
  userFacingName() {
    return 'Dependencies'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Dependencies: ${summary}` : 'Analyzing dependencies'
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
  toAutoClassifierInput(input) {
    return `${input.operation}${input.packageName ? ` ${input.packageName}` : ''}`
  },
  async validateInput(): Promise<ValidationResult> {
    return { result: true }
  },
  async checkPermissions(input): Promise<PermissionResult> {
    return { behavior: 'ask', message: `Run dependency command: ${input.operation}${input.packageName ? ` ${input.packageName}` : ''}` }
  },
  async prompt() {
    return getDescription()
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${output.summary}\n\n${output.details}`,
    }
  },
  async call(input, { abortController }) {
    const { operation, packageName, depth, production } = input
    const pm = detectPackageManager()

    try {
      switch (operation) {
        case 'audit': {
          let result: { stdout: string; stderr: string; exitCode: number }
          if (pm === 'npm') {
            result = await runCommand('npm', ['audit', '--json'], abortController.signal)
          } else if (pm === 'cargo') {
            result = await runCommand('cargo', ['audit'], abortController.signal)
          } else if (pm === 'pip') {
            result = await runCommand('pip-audit', ['--format=json'], abortController.signal)
          } else {
            result = await runCommand('go', ['install', 'github.com/securego/gosec/v2/cmd/gosec@latest'], abortController.signal)
            result = await runCommand('gosec', ['./...'], abortController.signal)
          }

          const output = result.stdout || result.stderr
          let vulnCount = 0
          try {
            if (pm === 'npm') {
              const parsed = JSON.parse(output)
              vulnCount = parsed.metadata?.vulnerabilities
                ? Object.values(parsed.metadata.vulnerabilities as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
                : 0
            }
          } catch { /* ignore parse errors */ }

          return {
            data: {
              operation: 'audit',
              summary: vulnCount > 0 ? `${vulnCount} vulnerabilities found` : result.exitCode === 0 ? 'No vulnerabilities found' : 'Audit completed with warnings',
              details: output.substring(0, 30_000),
            },
          }
        }

        case 'outdated': {
          let result: { stdout: string; stderr: string; exitCode: number }
          if (pm === 'npm') {
            result = await runCommand('npm', ['outdated', '--json'], abortController.signal)
          } else if (pm === 'cargo') {
            result = await runCommand('cargo', ['install', 'cargo-outdated'], abortController.signal)
            result = await runCommand('cargo', ['outdated'], abortController.signal)
          } else if (pm === 'pip') {
            result = await runCommand('pip', ['list', '--outdated', '--format=json'], abortController.signal)
          } else {
            result = await runCommand('go', ['list', '-m', '-u', 'all'], abortController.signal)
          }

          const output = result.stdout || result.stderr
          let outdatedCount = 0
          try {
            if (pm === 'npm') {
              outdatedCount = Object.keys(JSON.parse(output)).length
            } else if (pm === 'pip') {
              outdatedCount = JSON.parse(output).length
            }
          } catch { /* ignore */ }

          return {
            data: {
              operation: 'outdated',
              summary: `${outdatedCount} outdated packages`,
              details: output.substring(0, 30_000),
            },
          }
        }

        case 'graph': {
          const depDepth = depth ?? 2
          let result: { stdout: string; stderr: string; exitCode: number }
          if (pm === 'npm') {
            const args = ['ls', '--json', `--depth=${depDepth}`]
            if (production) args.push('--production')
            result = await runCommand('npm', args, abortController.signal)
          } else if (pm === 'cargo') {
            result = await runCommand('cargo', ['tree', '--depth', depDepth.toString()], abortController.signal)
          } else if (pm === 'pip') {
            result = await runCommand('pipdeptree', ['--json-tree'], abortController.signal)
          } else {
            result = await runCommand('go', ['mod', 'graph'], abortController.signal)
          }

          const output = result.stdout || result.stderr
          const lineCount = output.split('\n').filter(Boolean).length
          return {
            data: {
              operation: 'graph',
              summary: `${lineCount} dependency relationships`,
              details: output.substring(0, 30_000),
            },
          }
        }

        case 'license': {
          let result: { stdout: string; stderr: string; exitCode: number }
          if (pm === 'npm') {
            result = await runCommand('npx', ['license-checker', '--json'], abortController.signal)
          } else if (pm === 'cargo') {
            result = await runCommand('cargo', ['install', 'cargo-license'], abortController.signal)
            result = await runCommand('cargo', ['license', '--json'], abortController.signal)
          } else if (pm === 'pip') {
            result = await runCommand('pip-licenses', ['--format=json'], abortController.signal)
          } else {
            result = await runCommand('go-licenses', ['csv', './...'], abortController.signal)
          }

          const output = result.stdout || result.stderr
          return {
            data: {
              operation: 'license',
              summary: `License info collected`,
              details: output.substring(0, 30_000),
            },
          }
        }

        case 'info': {
          if (!packageName) throw new Error('packageName is required for info operation')
          let result: { stdout: string; stderr: string; exitCode: number }
          if (pm === 'npm') {
            result = await runCommand('npm', ['view', packageName, '--json'], abortController.signal)
          } else if (pm === 'cargo') {
            result = await runCommand('cargo', ['search', packageName, '--limit', '1'], abortController.signal)
          } else if (pm === 'pip') {
            result = await runCommand('pip', ['show', packageName], abortController.signal)
          } else {
            result = await runCommand('go', ['list', '-m', '-json', packageName], abortController.signal)
          }

          const output = result.stdout || result.stderr
          return {
            data: {
              operation: 'info',
              summary: `Info for ${packageName}`,
              details: output.substring(0, 30_000),
            },
          }
        }

        default:
          throw new Error(`Unknown operation: ${operation}`)
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      return {
        data: {
          operation,
          summary: `${operation} failed`,
          details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
