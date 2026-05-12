import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, LINT_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    tool: z.enum(['eslint', 'prettier', 'ruff', 'biome', 'golangci-lint', 'clippy']).optional().describe('Linter tool. Auto-detected from config if omitted.'),
    path: z.string().optional().default('.').describe('File or directory to lint.'),
    fix: z.boolean().optional().default(false).describe('Auto-fix issues when supported.'),
    config: z.string().optional().describe('Path to linter config file.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const findingSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
  message: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  rule: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    tool: z.string(),
    errors: z.number(),
    warnings: z.number(),
    fixed: z.number().optional(),
    findings: z.array(findingSchema),
    configFile: z.string().optional(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_FINDINGS = 200

const LINTERS: Record<string, { binary: string; configFiles: string[] }> = {
  eslint: { binary: 'eslint', configFiles: ['.eslintrc', '.eslintrc.js', '.eslintrc.json', 'eslint.config.js'] },
  prettier: { binary: 'prettier', configFiles: ['.prettierrc', '.prettierrc.json', 'prettier.config.js'] },
  ruff: { binary: 'ruff', configFiles: ['ruff.toml', '.ruff.toml', 'pyproject.toml'] },
  biome: { binary: 'biome', configFiles: ['biome.json'] },
  'golangci-lint': { binary: 'golangci-lint', configFiles: ['.golangci.yml'] },
  clippy: { binary: 'cargo', configFiles: ['Cargo.toml'] },
}

function detectTool(dir: string): string | null {
  for (const [name, l] of Object.entries(LINTERS)) {
    for (const f of l.configFiles) {
      if (existsSync(resolve(dir, f))) return name
    }
  }
  return null
}

function parseEslintOutput(stdout: string): Output['findings'] {
  try {
    const data = JSON.parse(stdout)
    if (!Array.isArray(data)) return []
    const findings: Output['findings'] = []
    for (const file of data) {
      if (!file.messages) continue
      for (const msg of file.messages) {
        findings.push({
          file: file.filePath || '',
          line: msg.line,
          column: msg.column,
          message: msg.message,
          severity: msg.severity === 2 ? 'error' : 'warning',
          rule: msg.ruleId || undefined,
        })
      }
    }
    return findings.slice(0, MAX_FINDINGS)
  } catch { return [] }
}

function parseGenericOutput(stdout: string): Output['findings'] {
  const findings: Output['findings'] = []
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^([^:]+):(\d+):(\d+):\s+(error|warning):\s+(.+)$/)
    if (m) findings.push({ file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10), severity: m[4] as 'error' | 'warning', message: m[5] })
  }
  return findings.slice(0, MAX_FINDINGS)
}

export const LintTool: ToolDef<InputSchema, Output> = {
  name: LINT_TOOL_NAME,
  searchHint: 'run linters and code formatters',
  maxResultSizeChars: 100_000,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Lint',
  isReadOnly(input) { return input ? !input.fix : true },
  isDestructive(input) { return input ? input.fix === true : false },
  toAutoClassifierInput(input) { return `${input.tool ?? 'auto'} ${input.path}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (input.tool && !LINTERS[input.tool]) return { result: false, message: `Unsupported linter: ${input.tool}`, errorCode: 1 }
    return { result: true }
  },
  async checkPermissions(input) {
    const desc = `${input.tool ?? 'auto'} ${input.fix ? '(fix mode) ' : ''}on ${input.path}`
    return { behavior: 'ask', askReason: `Run ${desc}?`, updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return { type: 'text', text: `Running ${input.tool ?? 'auto'} linter on ${input.path}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `Linter failed: ${output.error}` }
    const parts = [`${output.tool}: ${output.errors} errors, ${output.warnings} warnings`]
    if (output.fixed) parts.push(`${output.fixed} auto-fixed`)
    parts.push(`in ${output.durationMs}ms`)
    return { type: 'text', text: parts.join(', ') }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const targetPath = resolve(expandPath(input.path ?? '.'))
    const toolName = input.tool ?? detectTool(targetPath)

    if (!toolName) return { data: { success: false, tool: 'unknown', errors: 0, warnings: 0, findings: [], durationMs: Date.now() - startTime, error: 'No linter config detected. Specify a tool or add a config file.' } }

    try {
      const args: string[] = []
      if (toolName === 'eslint') { args.push('-f', 'json'); if (input.fix) args.push('--fix'); args.push(targetPath) }
      else if (toolName === 'prettier') { args.push('--check'); if (input.fix) args.push('--write'); args.push(targetPath) }
      else if (toolName === 'ruff') { args.push('check'); if (input.fix) args.push('--fix'); args.push(targetPath) }
      else if (toolName === 'biome') { args.push('check'); if (input.fix) args.push('--apply'); args.push(targetPath) }
      else if (toolName === 'golangci-lint') { args.push('run'); if (input.fix) args.push('--fix'); args.push(targetPath) }
      else if (toolName === 'clippy') { args.push('clippy'); args.push('--'); args.push('-D', 'warnings') }

      const binary = LINTERS[toolName].binary
      const result = spawnSync(binary, args, { cwd: targetPath, timeout: 120_000, maxBuffer: 100_000, encoding: 'utf-8' })

      const stdout = result.stdout ?? ''
      const stderr = result.stderr ?? ''

      let findings: Output['findings'] = []
      if (toolName === 'eslint') { findings = parseEslintOutput(stdout) }
      else { findings = parseGenericOutput(stdout) }

      if (findings.length === 0 && stderr) findings = parseGenericOutput(stderr)
      if (findings.length === 0 && result.status !== 0 && stderr) {
        return { data: { success: true, tool: toolName, errors: 0, warnings: 0, findings: [], durationMs: Date.now() - startTime, error: stderr.slice(0, 2000) } }
      }

      const errors = findings.filter(f => f.severity === 'error').length
      const warnings = findings.filter(f => f.severity === 'warning').length

      return { data: { success: true, tool: toolName, errors, warnings, findings, durationMs: Date.now() - startTime } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, tool: toolName, errors: 0, warnings: 0, findings: [], durationMs: Date.now() - startTime, error: msg } }
    }
  },
}
