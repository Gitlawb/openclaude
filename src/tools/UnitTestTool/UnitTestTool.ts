import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, UNIT_TEST_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    framework: z.enum(['jest', 'vitest', 'bun', 'pytest', 'go', 'cargo']).optional().describe('Test framework. Auto-detected.'),
    path: z.string().optional().default('.').describe('File or directory to test.'),
    filter: z.string().optional().describe('Test name pattern filter.'),
    coverage: z.boolean().optional().default(false).describe('Generate coverage report.'),
    timeout: z.number().min(1).max(3600).optional().default(300).describe('Timeout in seconds.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    framework: z.string(),
    passed: z.number(),
    failed: z.number(),
    total: z.number(),
    durationMs: z.number(),
    output: z.string().optional(),
    coverage: z.object({ lines: z.number().optional(), branches: z.number().optional(), functions: z.number().optional() }).optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const FRAMEWORKS: Record<string, { binary: string; detectFiles: string[]; defaultArgs: string[] }> = {
  jest: { binary: 'jest', detectFiles: ['jest.config.js', 'jest.config.ts', 'jest.config.json'], defaultArgs: ['--no-coverage'] },
  vitest: { binary: 'vitest', detectFiles: ['vitest.config.ts', 'vitest.config.js'], defaultArgs: ['run'] },
  bun: { binary: 'bun', detectFiles: ['bun.lockb', 'bun.lock'], defaultArgs: ['test'] },
  pytest: { binary: 'python', detectFiles: ['pytest.ini', 'pyproject.toml'], defaultArgs: ['-m', 'pytest'] },
  go: { binary: 'go', detectFiles: ['go.mod'], defaultArgs: ['test'] },
  cargo: { binary: 'cargo', detectFiles: ['Cargo.toml'], defaultArgs: ['test'] },
}

function detectFramework(dir: string): string | null {
  for (const [name, fw] of Object.entries(FRAMEWORKS)) {
    for (const f of fw.detectFiles) {
      if (existsSync(resolve(dir, f))) return name
    }
  }
  return null
}

export const UnitTestTool: ToolDef<InputSchema, Output> = {
  name: UNIT_TEST_TOOL_NAME,
  searchHint: 'run unit tests with structured results',
  maxResultSizeChars: 200_000,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Unit Test',
  isReadOnly() { return false },
  isDestructive() { return false },
  toAutoClassifierInput(input) { return `${input.framework ?? 'auto'}: ${input.filter ?? input.path}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (input.timeout !== undefined && (input.timeout < 1 || input.timeout > 3600)) return { result: false, message: 'Timeout must be between 1 and 3600 seconds', errorCode: 1 }
    return { result: true }
  },
  async checkPermissions(input) {
    return { behavior: 'ask', message: `${input.framework ?? 'auto'} test on ${input.path}${input.coverage ? ' (with coverage)' : ''}`, updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    const fw = input.framework ?? 'auto-detected'
    const cov = input.coverage ? ' with coverage' : ''
    return { type: 'text', text: `Running ${fw} tests${cov} on ${input.path}` }
  },
  renderToolResultMessage(output) {
    if (!output.success && output.error) return { type: 'text', text: `Tests failed (${output.framework}): ${output.error}` }
    if (output.total === 0) return { type: 'text', text: `${output.framework}: No tests found in ${output.durationMs}ms` }
    let msg = `${output.framework}: ${output.passed}/${output.total} passed in ${output.durationMs}ms`
    if (output.failed > 0) msg = `${output.framework}: ${output.failed} failed, ${output.passed} passed in ${output.durationMs}ms`
    if (output.coverage?.lines) msg += ` (lines: ${output.coverage.lines}%)`
    return { type: 'text', text: msg }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const targetPath = resolve(expandPath(input.path ?? '.'))
    const fwName = input.framework ?? detectFramework(targetPath)

    if (!fwName) return { data: { success: false, framework: 'unknown', passed: 0, failed: 0, total: 0, durationMs: Date.now() - startTime, error: 'No test framework detected.' } }

    const fw = FRAMEWORKS[fwName]
    if (!fw) return { data: { success: false, framework: fwName, passed: 0, failed: 0, total: 0, durationMs: Date.now() - startTime, error: `Unsupported framework: ${fwName}` } }

    try {
      const args = [...fw.defaultArgs]
      if (input.coverage) args.push('--coverage')
      if (input.filter && (fwName === 'jest' || fwName === 'vitest')) args.push('--testNamePattern', input.filter)
      if (fwName === 'go' && input.filter) args.push('-run', input.filter)
      if (fwName === 'cargo' && input.filter) args.push('--', input.filter)
      if (fwName !== 'bun') args.push(targetPath)
      else if (input.filter) args.push('--test-name-pattern', input.filter)

      const result = spawnSync(fw.binary, args, { cwd: targetPath, timeout: (input.timeout ?? 300) * 1000, maxBuffer: 200_000, encoding: 'utf-8' })

      if (result.error) return { data: { success: false, framework: fwName, passed: 0, failed: 0, total: 0, durationMs: Date.now() - startTime, error: `Failed to run ${fw.binary}: ${result.error.message}` } }

      const stdout = result.stdout ?? ''
      const stderr = result.stderr ?? ''
      const status = result.status ?? 1

      const passedMatch = stdout.match(/(\d+)\s+pass/)
      const failedMatch = stdout.match(/(\d+)\s+fail/)
      const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0
      const failed = failedMatch ? parseInt(failedMatch[1], 10) : status !== 0 && passed === 0 ? 1 : 0
      const total = passed + failed

      let coverage: Output['coverage'] | undefined
      if (input.coverage) {
        const cl = stdout.match(/Lines:\s+(\d+\.?\d*)%/)
        const cb = stdout.match(/Branches:\s+(\d+\.?\d*)%/)
        const cf = stdout.match(/Functions:\s+(\d+\.?\d*)%/)
        if (cl) coverage = { lines: parseFloat(cl[1]), branches: cb ? parseFloat(cb[1]) : undefined, functions: cf ? parseFloat(cf[1]) : undefined }
      }

      return { data: { success: failed === 0, framework: fwName, passed, failed, total, output: stdout.slice(0, 5000), coverage, durationMs: Date.now() - startTime } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, framework: fwName, passed: 0, failed: 1, total: 1, durationMs: Date.now() - startTime, error: msg } }
    }
  },
}
